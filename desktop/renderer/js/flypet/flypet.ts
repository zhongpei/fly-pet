/**
 * FlyPet sprite page: renders the avatar, forwards clicks, receives actions.
 * Talks to the main process over the electronAPI.flypet IPC bridge
 * (see src/flypet/link.ts and src/preload.ts).
 */
import { SpriteAvatar } from './sprite-avatar.js';

const hud = document.getElementById('hud') as HTMLDivElement;
const petEl = document.getElementById('pet') as HTMLImageElement;

const bridge = (window as unknown as {
  electronAPI?: { flypet?: {
    tap: () => void;
    status: () => Promise<{ connected: boolean; backend?: string }>;
    onAction: (cb: (a: { action: string; avatar: string }) => void) => void;
    onTelemetry: (cb: (t: Record<string, unknown>) => void) => void;
    onStatus: (cb: (s: Record<string, unknown>) => void) => void;
  } };
}).electronAPI?.flypet;

const avatar = new SpriteAvatar(petEl);
avatar.load('flypet/assets/').catch((err) => {
  hud.textContent = `avatar load failed: ${err.message ?? err}`;
});

// clicking the pet = touch; a drag on the drag-strip moves the window (CSS)
petEl.addEventListener('click', () => bridge?.tap());

let lastAction = '';
bridge?.onAction(({ action, avatar: name }) => {
  if (action !== lastAction) {
    lastAction = action;
    avatar.setAction(name);
    renderHud();
  }
});

let backend = '';
let connected = false;
bridge?.onStatus((s) => {
  connected = Boolean(s.connected);
  backend = String(s.backend ?? backend);
  renderHud();
});

let sps = 0;
let ready = true;
let load = 0;
bridge?.onTelemetry((t) => {
  sps = Number(t.steps_per_s ?? sps);
  ready = Boolean(t.ready ?? ready);
  load = Number(t.load ?? load);
  connected = true; // telemetry flowing proves the link is up
  renderHud();
});

// the page may load after the link already came up: ask for the current state
bridge?.status().then((s) => {
  connected = Boolean(s.connected);
  backend = String(s.backend ?? backend);
  renderHud();
}).catch(() => { /* main side gone; telemetry will correct us */ });

function renderHud(): void {
  const link = connected ? (ready ? `${backend}` : `${backend} (loading)`) : 'offline';
  hud.textContent =
    `flypet · ${link}\n` +
    `action ${lastAction || '—'}   ${sps.toFixed(0)} steps/s   load ${(load * 100).toFixed(0)}%`;
}
