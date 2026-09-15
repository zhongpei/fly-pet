import { SpriteAvatar } from './sprite-avatar.js';
const hud = document.getElementById('hud');
const petEl = document.getElementById('pet');
const bridge = window.electronAPI?.flypet;
const avatar = new SpriteAvatar(petEl);
avatar.load('flypet/assets/').catch((err) => {
    hud.textContent = `avatar load failed: ${err.message ?? err}`;
});
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
    connected = true;
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
            `action ${lastAction || '—'}   ${sps.toFixed(0)} steps/s   load ${(load * 100).toFixed(0)}%`;
}
