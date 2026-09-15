/**
 * FlyPet sprite/Live2D page: renders the avatar, forwards touch events,
 * receives actions + expressions + continuous params.
 * Talks to the main process over the electronAPI.flypet IPC bridge.
 */
import type { AvatarParams, AvatarProvider } from './avatar';
import { SpriteAvatar } from './sprite-avatar.js';
import { Live2DAvatar } from './live2d-avatar.js';

const hud = document.getElementById('hud') as HTMLDivElement;
const petEl = document.getElementById('pet') as HTMLImageElement;
const live2dHost = document.getElementById('live2d') as HTMLDivElement;

const bridge = (window as unknown as {
  electronAPI?: { flypet?: {
    tap: () => void;
    sensory: (kind: string, extra?: Record<string, unknown>) => void;
    status: () => Promise<{ connected: boolean; backend?: string }>;
    onAction: (cb: (a: { action: string; avatar: string; expression?: string; params?: AvatarParams }) => void) => void;
    onTelemetry: (cb: (t: Record<string, unknown>) => void) => void;
    onStatus: (cb: (s: Record<string, unknown>) => void) => void;
  } };
}).electronAPI?.flypet;

// ---- avatar provider selection ---------------------------------------------

// default is Live2D (richer expression layer); ?avatar=sprite keeps the fallback
const wantSprite = new URLSearchParams(location.search).get('avatar') === 'sprite';
let avatar: AvatarProvider;
if (wantSprite) {
  live2dHost.style.display = 'none';
  avatar = new SpriteAvatar(petEl);
} else {
  petEl.style.display = 'none';
  avatar = new Live2DAvatar(live2dHost);
}
avatar.load().catch((err: Error) => {
  hud.textContent = `avatar load failed: ${err.message}`;
});

// ---- touch -> sensory events ------------------------------------------------
// Handlers go on the VISIBLE container: in Live2D mode the sprite <img> is
// display:none and would never receive real pointer events.

// single click = poke; two quick clicks = startle; hold >= 600 ms = petting
let lastClickAt = 0;
let downAt = 0;
let pointerDown = false;
let petting = false;
let suppressClick = false;

function bindTouch(el: HTMLElement): void {
  el.addEventListener('pointerdown', () => {
    pointerDown = true;
    downAt = Date.now();
    suppressClick = false;
    window.setTimeout(() => {
      // the pointer must STILL be down: a quick click releases long before
      // this timer fires, and petting must not latch on without a release
      if (pointerDown && Date.now() - downAt >= 550 && !petting) {
        petting = true;
        suppressClick = true;
        bridge?.sensory('pet_long_press');
      }
    }, 600);
  });
  const release = () => {
    pointerDown = false;
    if (petting) {
      petting = false;
      bridge?.sensory('pet_long_release');
    }
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('click', () => {
    if (suppressClick) return;
    bridge?.tap();
    const t = Date.now();
    if (t - lastClickAt < 350) {
      bridge?.sensory('pet_double_click');
      lastClickAt = 0;
    } else {
      lastClickAt = t;
    }
  });
}
bindTouch(wantSprite ? petEl : live2dHost);

// ---- brain output -----------------------------------------------------------

let lastAction = '';
let lastExpression = '';
let backend = '';
let connected = false;
let sps = 0;
let ready = true;
let load = 0;

bridge?.onAction(({ action, avatar: name, expression, params }) => {
  if (action !== lastAction) {
    lastAction = action;
    avatar.setAction(name);
    renderHud();
  }
  if (expression) applyExpression(expression);
  if (params) avatar.setParams(params);
});

function applyExpression(expr: string): void {
  if (expr !== lastExpression) {
    lastExpression = expr;
    avatar.setExpression(expr, 0.5, 0);
    renderHud();
  }
}

bridge?.onStatus((s) => {
  connected = Boolean(s.connected);
  backend = String(s.backend ?? backend);
  renderHud();
});

bridge?.onTelemetry((t) => {
  sps = Number(t.steps_per_s ?? sps);
  ready = Boolean(t.ready ?? ready);
  load = Number(t.load ?? load);
  connected = true; // telemetry flowing proves the link is up
  const emo = (t.emotion ?? {}) as Record<string, unknown>;
  const params = (t.params ?? {}) as AvatarParams;
  if (params.speed !== undefined) avatar.setParams(params);
  applyExpression(String(emo.expression ?? lastExpression));
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
    `action ${lastAction || '—'} · expr ${lastExpression || '—'}\n` +
    `${sps.toFixed(0)} steps/s   load ${(load * 100).toFixed(0)}%`;
}
