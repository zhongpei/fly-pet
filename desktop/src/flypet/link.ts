/**
 * FlyPet brain link (main process): one WebSocket to brain-service, plus the
 * desktop sensors and the window walker that turns brain actions into motion.
 *
 *   cursor poll (80 ms) -> mouse_move / mouse_approach
 *   window moved        -> pet_drag
 *   renderer click      -> pet_click          (via ipc 'flypet:tap')
 *   brain_state         -> webContents 'flypet:action' + window walking
 */
import { BrowserWindow, ipcMain, screen } from 'electron';
import WebSocket from 'ws';
import { CursorSensor, Rect, SensoryMsg } from './sensor';

const RECONNECT_MS = 2000;
const POLL_MS = 80;

/** Window speed magnitude (px/s) per moving action, before the speed scalar.
 *  DIRECTION comes from the brain (params.dir): the decoder knows the cursor
 *  side, so APPROACH moves toward it, escapes away, WANDER keeps the direction
 *  it picked — the walker never guesses a direction itself. */
const WALK_MAG: Record<string, number> = {
  MOVE_LEFT: 130,
  MOVE_RIGHT: 130,
  APPROACH: 320,
  AVOID: 400,
  JUMP: 400,
  BACK: 110,
  WANDER: 80,
};

export function startFlyPetLink(getWindow: () => BrowserWindow | null, url?: string): () => void {
  const brainUrl = url || process.env.FLYPET_BRAIN_URL || 'ws://127.0.0.1:8020/ws';
  const sensor = new CursorSensor();
  let ws: WebSocket | null = null;
  let closed = false;
  let lastBounds: Rect | null = null;
  let walkVx = 0;              // current window velocity, px/s
  let walkerTimer: NodeJS.Timeout | null = null;
  let linkConnected = false;
  let backendName = '';
  let lastWalkSpeed = 0.4;     // DNg100-derived 0..1, matches the model's bob rate
  let moveAccum = 0;
  let lastAction = '';         // escapes scurry at a higher step rate

  const status = (s: Record<string, unknown>) => {
    if ('connected' in s) linkConnected = Boolean(s.connected);
    if ('backend' in s) backendName = String(s.backend ?? backendName);
    getWindow()?.webContents.send('flypet:status', { connected: linkConnected, backend: backendName, ...s });
  };

  const sendEvent = (msg: SensoryMsg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const connect = () => {
    if (closed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(brainUrl);
    } catch {
      setTimeout(connect, RECONNECT_MS);
      return;
    }
    socket.on('open', () => {
      ws = socket;
      status({ connected: true, url: brainUrl });
    });
    socket.on('message', (raw: WebSocket.RawData) => {
      let msg: { type: string; action?: string; avatar?: string; backend?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'brain_state' && msg.action && msg.avatar) {
        onAction(msg.action, (msg as { params?: { speed?: number; dir?: number } }).params);
        getWindow()?.webContents.send('flypet:action', {
          action: msg.action, avatar: msg.avatar,
          expression: (msg as { expression?: string }).expression,
          params: {
            ...(msg as { params?: Record<string, number> }).params,
            moving: walkVx !== 0,          // window is being walked right now
            vx: walkVx,                    // px/s, sign = direction
          },
        });
      } else if (msg.type === 'brain_telemetry') {
        getWindow()?.webContents.send('flypet:telemetry', msg);
      } else if (msg.type === 'welcome') {
        status({ connected: true, backend: msg.backend });
      }
    });    socket.on('close', () => {
      if (ws === socket) ws = null;
      status({ connected: false });
      if (!closed) setTimeout(connect, RECONNECT_MS);
    });
    socket.on('error', () => { /* close handler does the reconnect */ });
  };

  // ---- window walker -----------------------------------------------------

  const onAction = (action: string, params?: { speed?: number; dir?: number }) => {
    const speed = Math.max(0, Math.min(1, params?.speed ?? 0));
    lastWalkSpeed = speed;
    lastAction = action;
    if (held) {                 // grabbed: the user's hand owns the window
      walkVx = 0;
      return;
    }
    const base = WALK_MAG[action];
    const dir = params?.dir ?? 0;
    if (!base || !dir) {
      walkVx = 0;               // not a moving action, or the brain says stay
      return;
    }
    walkVx = dir * base * (0.7 + 0.6 * speed);
    if (walkerTimer === null) {
      walkerTimer = setInterval(step, 33);
    }
    if (lastAction === 'JUMP' || lastAction === 'AVOID') {
      moveAccum = Number.MAX_VALUE;   // a startle must move NOW: it lasts <100 ms
      step();
    }
  };

  /**
   * Step-quantised walking: the window does NOT glide. Displacement is
   * delivered in discrete chunks at the same steps-per-second rate as the
   * model's bob (5.5 + 7*speed Hz), so each bob landing is one visible step.
   */
  const step = () => {
    const win = getWindow();
    if (!win || walkVx === 0) {
      moveAccum = 0;
      if (walkerTimer !== null) {
        clearInterval(walkerTimer);
        walkerTimer = null;
      }
      return;
    }
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds).workArea;
    const speed = Math.max(0.15, Math.min(1, lastWalkSpeed));
    // One window step per model bob (nya_map uses the same rate for its AllY
    // bob; kept below 4.5 Hz so the 10 Hz parameter stream doesn't alias).
    // Escapes are the exception: JUMP/AVOID last only ~0.4 s, which is shorter
    // than one slow step — they scurry in small fast steps instead.
    const scurry = lastAction === 'JUMP' || lastAction === 'AVOID';
    const stepsPerSec = scurry ? 12.0 : 2.2 + 2.3 * speed;
    const pxPerSec = Math.abs(walkVx);
    moveAccum += pxPerSec * 0.033;
    const stepPx = Math.max(scurry ? 4 : 6, pxPerSec / stepsPerSec);
    if (moveAccum >= stepPx) {
      const nx = Math.max(display.x, Math.min(display.x + display.width - bounds.width,
          bounds.x + Math.round(Math.sign(walkVx) * stepPx)));
      if (nx !== bounds.x) {
        win.setPosition(nx, bounds.y);
        lastSelfMove = Date.now();
      }
      moveAccum -= stepPx;
      if (nx === display.x || nx === display.x + display.width - bounds.width) {
        walkVx = 0; // reached the edge; keep the animation but stop stepping
        moveAccum = 0;
        if (walkerTimer !== null) {
          clearInterval(walkerTimer);
          walkerTimer = null;
        }
      }
    }
  };
  let lastSelfMove = 0;
  let lastSimMove = 0;

  // ---- sensors -----------------------------------------------------------

  // The user grabbing the pet = dragging the window. While held the walker
  // must stand down (the user's hand owns the window) and the brain feels a
  // strong sustained contact; release after a quiet gap.
  let held = false;
  let lastExternalMove = 0;
  const releaseHold = () => {
    held = false;
    sendEvent({ type: 'sensory_event', kind: 'pet_held_release', ts: Date.now() / 1000 });
  };

  const pollTimer = setInterval(() => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    // FLYPET_SIM_HELD=1: periodically nudge the window from outside the
    // walker, to exercise the grabbed/released path without a real drag.
    if (process.env.FLYPET_SIM_HELD === '1') {
      const t = Date.now() / 1000;
      if (t - lastSimMove > 2.0) {
        lastSimMove = t;
        const b = win.getBounds();
        win.setPosition(b.x + (Math.sin(t) > 0 ? 40 : -40), b.y);
      }
    }
    const bounds = win.getBounds();
    if (lastBounds && (bounds.x !== lastBounds.x || bounds.y !== lastBounds.y)
        && Date.now() - lastSelfMove > 150) {
      // bounds moved by something other than our own walking => the user is
      // dragging the pet around
      lastExternalMove = Date.now();
      if (!held) {
        held = true;
        walkVx = 0;                       // stop walking while grabbed
        if (walkerTimer !== null) {
          clearInterval(walkerTimer);
          walkerTimer = null;
        }
        sendEvent({ type: 'sensory_event', kind: 'pet_held', ts: Date.now() / 1000 });
      }
    } else if (held && Date.now() - lastExternalMove > 500) {
      releaseHold();
    }
    lastBounds = { ...bounds };
    const cursor = screen.getCursorScreenPoint();
    for (const ev of sensor.poll(cursor, bounds, Date.now())) sendEvent(ev);
  }, POLL_MS);

  const onTap = (_e: Electron.IpcMainEvent, cls?: string) => {
    sendEvent({ type: 'sensory_event', kind: 'pet_click', cls: cls || '', ts: Date.now() / 1000 });
  };
  ipcMain.on('flypet:tap', onTap);

  // generic pass-through for V1 events (double click, petting, objects, ...)
  const onSensory = (_e: Electron.IpcMainEvent, payload?: { kind?: string } & Record<string, unknown>) => {
    const { kind, ...extra } = payload ?? {};
    if (!kind) return;
    sendEvent({ type: 'sensory_event', kind, ts: Date.now() / 1000, ...extra } as SensoryMsg);
  };
  ipcMain.on('flypet:sensory', onSensory);

  // pages that load after the link came up ask for the current state
  ipcMain.handle('flypet:status-query', () => ({ connected: linkConnected, backend: backendName }));

  connect();

  return () => {
    closed = true;
    clearInterval(pollTimer);
    if (walkerTimer !== null) clearInterval(walkerTimer);
    ipcMain.removeListener('flypet:tap', onTap);
    ipcMain.removeListener('flypet:sensory', onSensory);
    ipcMain.removeHandler('flypet:status-query');
    ws?.close();
  };
}
