import { SpriteAvatar } from './sprite-avatar.js';
import { Live2DAvatar } from './live2d-avatar.js';
const hud = document.getElementById('hud');
const petEl = document.getElementById('pet');
const live2dHost = document.getElementById('live2d');
const bridge = window.electronAPI?.flypet;
const wantLive2D = new URLSearchParams(location.search).get('avatar') === 'live2d';
let avatar;
if (wantLive2D) {
    petEl.style.display = 'none';
    avatar = new Live2DAvatar(live2dHost);
}
else {
    live2dHost.style.display = 'none';
    avatar = new SpriteAvatar(petEl);
}
avatar.load().catch((err) => {
    hud.textContent = `avatar load failed: ${err.message}`;
});
let lastClickAt = 0;
let downAt = 0;
let petting = false;
let suppressClick = false;
petEl.addEventListener('pointerdown', () => {
    downAt = Date.now();
    suppressClick = false;
    window.setTimeout(() => {
        if (Date.now() - downAt >= 550 && !petting) {
            petting = true;
            suppressClick = true;
            bridge?.sensory('pet_long_press');
        }
    }, 600);
});
petEl.addEventListener('pointerup', () => {
    if (petting) {
        petting = false;
        bridge?.sensory('pet_long_release');
    }
});
petEl.addEventListener('click', () => {
    if (suppressClick)
        return;
    bridge?.tap();
    const t = Date.now();
    if (t - lastClickAt < 350) {
        bridge?.sensory('pet_double_click');
        lastClickAt = 0;
    }
    else {
        lastClickAt = t;
    }
});
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
    if (expression)
        applyExpression(expression);
    if (params)
        avatar.setParams(params);
});
function applyExpression(expr) {
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
    connected = true;
    const emo = (t.emotion ?? {});
    const params = (t.params ?? {});
    if (params.speed !== undefined)
        avatar.setParams(params);
    applyExpression(String(emo.expression ?? lastExpression));
    renderHud();
});
bridge?.status().then((s) => {
    connected = Boolean(s.connected);
    backend = String(s.backend ?? backend);
    renderHud();
}).catch(() => { });
function renderHud() {
    const link = connected ? (ready ? `${backend}` : `${backend} (loading)`) : 'offline';
    hud.textContent =
        `flypet · ${link}\n` +
            `action ${lastAction || '—'} · expr ${lastExpression || '—'}\n` +
            `${sps.toFixed(0)} steps/s   load ${(load * 100).toFixed(0)}%`;
}
