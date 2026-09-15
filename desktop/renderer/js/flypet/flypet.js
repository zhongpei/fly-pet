import { SpriteAvatar } from './sprite-avatar.js';
import { Live2DAvatar } from './live2d-avatar.js';
const hud = document.getElementById('hud');
const petEl = document.getElementById('pet');
const live2dHost = document.getElementById('live2d');
const bridge = window.electronAPI?.flypet;
const wantSprite = new URLSearchParams(location.search).get('avatar') === 'sprite';
let avatar;
if (wantSprite) {
    live2dHost.style.display = 'none';
    avatar = new SpriteAvatar(petEl);
}
else {
    petEl.style.display = 'none';
    avatar = new Live2DAvatar(live2dHost);
}
avatar.load().catch((err) => {
    hud.textContent = `avatar load failed: ${err.message}`;
});
let lastClickAt = 0;
let downAt = 0;
let pointerDown = false;
let petting = false;
let suppressClick = false;
function bindTouch(el) {
    el.addEventListener('pointerdown', () => {
        pointerDown = true;
        downAt = Date.now();
        suppressClick = false;
        window.setTimeout(() => {
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
}
bindTouch(wantSprite ? petEl : live2dHost);
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
