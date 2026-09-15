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

/** Window velocity (px/s) per action; speed-scaled where the brain says so. */
const WALK_SPEED: Record<string, number> = {
  MOVE_LEFT: -130,
  MOVE_RIGHT: 130,
  BACK: 110,        // away from the cursor's last side
  WANDER: 70,       // direction picked when the action starts
};

export function startFlyPetLink(getWindow: () => BrowserWindow | null, url?: string): () => void {
  const brainUrl = url || process.env.FLYPET_BRAIN_URL || 'ws://127.0.0.1:8020/ws';
  const sensor = new CursorSensor();
  let ws: WebSocket | null = null;
  let closed = false;
  let lastBounds: Rect | null = null;
  let lastX = 0;               // last normalized cursor x, for APPROACH/AVOID direction
  let walkVx = 0;              // current window velocity, px/s
  let walkerTimer: NodeJS.Timeout | null = null;
  let linkConnected = false;
  let backendName = '';
  let previousAction = '';

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
        onAction(msg.action, (msg as { params?: { speed?: number } }).params);
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

  const onAction = (action: string, params?: { speed?: number }) => {
    const speed = Math.max(0, Math.min(1, params?.speed ?? 0));
    if (action === 'APPROACH') {
      walkVx = (lastX < 0 ? -1 : lastX > 0 ? 1 : 0) * (120 + 200 * speed); // walk toward the cursor
    } else if (action === 'AVOID' || action === 'JUMP') {
      walkVx = (lastX <= 0 ? 1 : -1) * (260 + 140 * speed);               // sprint away from it
    } else if (action === 'BACK') {
      walkVx = (lastX <= 0 ? 1 : -1) * WALK_SPEED.BACK;                   // slow retreat
    } else if (action === 'WANDER') {
      if (walkVx === 0 || previousAction !== 'WANDER') {
        walkVx = (Math.random() < 0.5 ? -1 : 1) * WALK_SPEED.WANDER;      // pick a direction once
      }
    } else {
      const base = WALK_SPEED[action] ?? 0;
      walkVx = base === 0 ? 0 : Math.sign(base) * (Math.abs(base) * (0.7 + 0.6 * speed));
    }
    previousAction = action;
    if (walkVx !== 0 && walkerTimer === null) {
      walkerTimer = setInterval(step, 33);
    }
  };

  const step = () => {
    const win = getWindow();
    if (!win || walkVx === 0) {
      if (walkerTimer !== null) {
        clearInterval(walkerTimer);
        walkerTimer = null;
      }
      return;
    }
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds).workArea;
    const nx = Math.max(display.x, Math.min(display.x + display.width - bounds.width, bounds.x + Math.round(walkVx * 0.033)));
    if (nx !== bounds.x) {
      win.setPosition(nx, bounds.y);
      lastSelfMove = Date.now();  // walking is not the user dragging the pet
    }
    if (nx === display.x || nx === display.x + display.width - bounds.width) {
      walkVx = 0; // reached the edge; keep the animation but stop moving
      if (walkerTimer !== null) {
        clearInterval(walkerTimer);
        walkerTimer = null;
      }
    }
  };
  let lastSelfMove = 0;

  // ---- sensors -----------------------------------------------------------

  const pollTimer = setInterval(() => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    if (lastBounds && (bounds.x !== lastBounds.x || bounds.y !== lastBounds.y)
        && Date.now() - lastSelfMove > 150) {
      // bounds moved by something other than our own walking => the user is
      // dragging the pet around
      sendEvent({ type: 'sensory_event', kind: 'pet_drag', ts: Date.now() / 1000 });
    }
    lastBounds = { ...bounds };
    const cursor = screen.getCursorScreenPoint();
    const x = (cursor.x - (bounds.x + bounds.width / 2)) / 420;
    if (Math.abs(x) <= 1) lastX = x;
    for (const ev of sensor.poll(cursor, bounds, Date.now())) sendEvent(ev);
  }, POLL_MS);

  const onTap = (_e: Electron.IpcMainEvent) => {
    sendEvent({ type: 'sensory_event', kind: 'pet_click', ts: Date.now() / 1000 });
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
