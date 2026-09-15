/**
 * FlyPet page: renders the avatar through the copied NyaDeskPet Live2D
 * pipeline (default) or the sprite fallback, forwards touch events,
 * receives actions + expressions + continuous params.
 */
import type { AvatarParams, AvatarProvider } from './avatar.js';
import { SpriteAvatar } from './sprite-avatar.js';
import { ManagedLive2DAvatar } from './avatar-live2d.js';

const hud = document.getElementById('hud') as HTMLDivElement;
const petEl = document.getElementById('pet') as HTMLImageElement;
const live2dCanvas = document.getElementById('live2d-canvas') as HTMLCanvasElement;

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

// default is the Live2D pipeline; ?avatar=sprite keeps the lightweight fallback
const wantSprite = new URLSearchParams(location.search).get('avatar') === 'sprite';
let avatar: AvatarProvider;
if (wantSprite) {
  live2dCanvas.style.display = 'none';
  avatar = new SpriteAvatar(petEl);
} else {
  petEl.style.display = 'none';
  avatar = new ManagedLive2DAvatar(live2dCanvas);
}

// model taps reported by the live2d-manager pipeline (hit areas) land here
(window as unknown as { flypetTap?: () => void }).flypetTap = () => bridge?.tap();
(window as unknown as { __avatar?: AvatarProvider & { started?: boolean } }).__avatar = avatar;

avatar.load().catch((err: Error) => {
  (window as unknown as { __flypetLoadError?: string }).__flypetLoadError = err.message;
  hud.textContent = `avatar load failed: ${err.message}`;
});

// ---- touch -> sensory events ------------------------------------------------
// Handlers bind to the VISIBLE container. In Live2D mode a click also goes to
// live2dManager.tap for hit-area animation; the encoder's touch refractory
// dedupes the two reporting paths (manager tap_event + our own tap).

// single click = poke; two quick clicks = startle; hold >= 600 ms = petting
let lastClickAt = 0;
let downAt = 0;
let pointerDown = false;
let petting = false;
let suppressClick = false;

function bindTouch(el: HTMLElement): void {
  el.addEventListener('pointerdown', (e) => {
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
    void e;
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
  el.addEventListener('click', (e) => {
    if (suppressClick) return;
    bridge?.tap();
    // Live2D: let the manager play its hit-area reaction for this tap
    if (!wantSprite) {
      const me = e as MouseEvent;
      (window as unknown as { live2dManager?: { tap: (x: number, y: number) => void } })
        .live2dManager?.tap(me.offsetX, me.offsetY);
    }
    const t = Date.now();
    if (t - lastClickAt < 350) {
      bridge?.sensory('pet_double_click');
      lastClickAt = 0;
    } else {
      lastClickAt = t;
    }
  });
}
bindTouch(wantSprite ? petEl : live2dCanvas);

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
