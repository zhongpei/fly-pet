import { SpriteAvatar } from './sprite-avatar.js';
const ACTIONS = [
    'idle', 'walk_left', 'walk_right', 'walk', 'run', 'look', 'waving', 'sleep',
    'jump', 'back', 'threat', 'display', 'groom', 'turn_away', 'wander',
];
const petEl = document.getElementById('pet');
const label = document.getElementById('label');
const avatar = new SpriteAvatar(petEl);
avatar.load().then(() => {
    label.textContent = 'ready';
    window.__ready = true;
});
window.__setAction = (a) => {
    label.textContent = a;
    avatar.setAction(a);
};
window.__actions = ACTIONS;
