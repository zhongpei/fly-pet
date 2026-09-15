/**
 * SpriteAvatar: character.json + sprite.png sprite-sheet player
 * (format borrowed from TonyNa-code/desktop-pet, MIT).
 *
 * Implements the AvatarProvider contract; expression/params are V1 no-ops
 * except speed -> animation tempo (Live2D carries the full expression layer).
 */
import type { AvatarParams, AvatarProvider } from './avatar';

export interface CharacterJson {
  sprite: string;
  frame: { width: number; height: number };
  columns: number;
  states: Record<string, { row: number; frames: number; interval: number }>;
}

/** BrainAction avatar name -> character.json state (with optional speed). */
const AVATAR_TO_STATE: Record<string, { state: string; interval?: number }> = {
  idle: { state: 'idle' },
  walk_left: { state: 'runningLeft', interval: 170 },
  walk_right: { state: 'runningRight', interval: 170 },
  walk: { state: 'running', interval: 150 },
  run: { state: 'running', interval: 70 },
  look: { state: 'review' },
  waving: { state: 'waving' },
  sleep: { state: 'failed', interval: 380 },
  // V1 actions (sprite fallback: closest available row)
  jump: { state: 'jumping', interval: 110 },
  back: { state: 'running', interval: 260 },
  threat: { state: 'waving', interval: 70 },      // agitated flailing
  display: { state: 'waving', interval: 260 },    // proud slow wave
  groom: { state: 'review', interval: 220 },      // hand-to-face reads as grooming
  turn_away: { state: 'idle', interval: 1200 },
  wander: { state: 'running', interval: 240 },
};

export class SpriteAvatar implements AvatarProvider {
  private img = new Image();
  private char: CharacterJson | null = null;
  private stateName = 'idle';
  private interval = 900;
  private frame = 0;
  private acc = 0;
  private lastT = 0;
  private ready = false;
  private params: AvatarParams = { speed: 0, head_angle: 0 };

  constructor(private el: HTMLImageElement) {}

  async load(): Promise<void> {
    const char = await this.loadJson('flypet/assets/');
    this.char = char;
    await new Promise<void>((resolve, reject) => {
      this.img.onload = () => resolve();
      this.img.onerror = () => reject(new Error(`sprite load failed: ${this.img.src}`));
      this.img.src = `flypet/assets/${char.sprite}`;
    });
    this.ready = true;
    this.setAction('idle');
    requestAnimationFrame((t) => this.tick(t));
  }

  /** XHR instead of fetch: fetch() cannot read file:// URLs on a file:// page. */
  private loadJson(baseUrl: string): Promise<CharacterJson> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `${baseUrl}character.json`);
      xhr.onload = () => {
        if (xhr.status === 0 || xhr.status === 200) {
          try {
            resolve(JSON.parse(xhr.responseText) as CharacterJson);
          } catch (e) {
            reject(new Error(`bad character.json: ${String(e)}`));
          }
        } else {
          reject(new Error(`character.json HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error(`cannot load ${baseUrl}character.json`));
      xhr.send();
    });
  }

  setAction(avatar: string): void {
    if (!this.char) return;
    const mapping = AVATAR_TO_STATE[avatar] ?? AVATAR_TO_STATE.idle;
    const st = this.char.states[mapping.state] ?? this.char.states.idle;
    // walk speed raises the animation tempo
    const tempo = 1 - Math.min(0.5, (this.params.speed || 0) * 0.5);
    const interval = (mapping.interval ?? st.interval) * (avatar === 'walk' || avatar === 'run' ? tempo : 1);
    if (mapping.state === this.stateName && Math.abs(interval - this.interval) < 4) return;
    this.stateName = mapping.state;
    this.interval = interval;
    this.frame = 0;
    this.acc = 0;
    this.apply();
  }

  setExpression(_expr: string, _arousal: number, _valence: number): void {
    // sprite V1: expressions are Live2D-only
  }

  setParams(params: AvatarParams): void {
    this.params = params;
  }

  private apply(): void {
    if (!this.char) return;
    const st = this.char.states[this.stateName] ?? this.char.states.idle;
    const w = this.char.frame.width;
    const h = this.char.frame.height;
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    this.el.style.backgroundImage = `url("${this.img.src}")`;
    this.el.style.backgroundRepeat = 'no-repeat';
    this.el.style.backgroundPosition = `-${this.frame * w}px -${st.row * h}px`;
  }

  private tick(t: number): void {
    if (this.lastT === 0) this.lastT = t;
    const dt = t - this.lastT;
    this.lastT = t;
    const st = this.char?.states[this.stateName];
    if (st) {
      this.acc += dt;
      while (this.acc >= this.interval) {
        this.acc -= this.interval;
        this.frame = (this.frame + 1) % st.frames;
        this.apply();
      }
    }
    requestAnimationFrame((t2) => this.tick(t2));
  }

  get isReady(): boolean {
    return this.ready;
  }
}
