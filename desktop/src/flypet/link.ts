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

/** px/s horizontal velocity for each brain action. */
const WALK_SPEED: Record<string, number> = {
  MOVE_LEFT: -130,
  MOVE_RIGHT: 130,
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
        onAction(msg.action);
        getWindow()?.webContents.send('flypet:action', { action: msg.action, avatar: msg.avatar });
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

  const onAction = (action: string) => {
    if (action === 'APPROACH') {
      walkVx = lastX < 0 ? -170 : lastX > 0 ? 170 : 0; // walk toward the cursor
    } else if (action === 'AVOID') {
      walkVx = lastX <= 0 ? 300 : -300;               // sprint away from it
    } else {
      walkVx = WALK_SPEED[action] ?? 0;
    }
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
    if (nx !== bounds.x) win.setPosition(nx, bounds.y);
    if (nx === display.x || nx === display.x + display.width - bounds.width) {
      walkVx = 0; // reached the edge; keep the animation but stop moving
      if (walkerTimer !== null) {
        clearInterval(walkerTimer);
        walkerTimer = null;
      }
    }
  };

  // ---- sensors -----------------------------------------------------------

  const pollTimer = setInterval(() => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const bounds = win.getBounds();
    if (lastBounds && (bounds.x !== lastBounds.x || bounds.y !== lastBounds.y)) {
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

  // pages that load after the link came up ask for the current state
  ipcMain.handle('flypet:status-query', () => ({ connected: linkConnected, backend: backendName }));

  connect();

  return () => {
    closed = true;
    clearInterval(pollTimer);
    if (walkerTimer !== null) clearInterval(walkerTimer);
    ipcMain.removeListener('flypet:tap', onTap);
    ipcMain.removeHandler('flypet:status-query');
    ws?.close();
  };
}
