/** Standalone harness: drive the SpriteAvatar through every brain action. */
import { SpriteAvatar } from './sprite-avatar.js';

const ACTIONS = [
  'idle', 'walk_left', 'walk_right', 'walk', 'run', 'look', 'waving', 'sleep',
  'jump', 'back', 'threat', 'display', 'groom', 'turn_away', 'wander',
];

const petEl = document.getElementById('pet') as HTMLImageElement;
const label = document.getElementById('label') as HTMLDivElement;
const avatar = new SpriteAvatar(petEl);

avatar.load().then(() => {
  label.textContent = 'ready';
  (window as unknown as { __ready: boolean }).__ready = true;
});

(window as unknown as { __setAction: (a: string) => void }).__setAction = (a: string) => {
  label.textContent = a;
  avatar.setAction(a);
};

(window as unknown as { __actions: string[] }).__actions = ACTIONS;
