/**
 * Live2DAvatar: the mao_pro model driven by brain output.
 *
 * Continuous layer -> semantic Cubism parameters (models/.../param-map.json):
 *   head_angle -> head_turn_x (ParamAngleX)
 *   arousal    -> expression parameter presets (eye/mouth shapes)
 * Discrete actions -> motion groups (Idle / 6 generic motions).
 */
import type { AvatarParams, AvatarProvider } from './avatar';

declare const PIXI: any;

const MODEL_URL = '../models/live2d/mao_pro_zh/runtime/mao_pro.model3.json';

/** brain action -> [motion group, index] ('' group holds 6 generic motions). */
const ACTION_MOTION: Record<string, [string, number]> = {
  walk: ['', 0],
  run: ['', 1],
  walk_left: ['', 2],
  walk_right: ['', 3],
  back: ['', 4],
  wander: ['', 5],
  jump: ['Idle', 0],       // idle motion restart reads as a bounce until we get dedicated motion
  threat: ['', 1],
  display: ['', 2],
  groom: ['', 4],
  waving: ['', 2],
  look: ['', 3],
};

/** emotion -> parameter preset (semantics from param-map.json). */
function expressionParams(expr: string): Record<string, number> {
  switch (expr) {
    case 'content': return { left_eye_smile: 0.7, right_eye_smile: 0.7, left_eye_open: 0.75, right_eye_open: 0.75 };
    case 'curious': return { left_eye_open: 1.0, right_eye_open: 1.0, gaze_y: 0.3 };
    case 'alert': return { left_eye_open: 1.0, right_eye_open: 1.0 };
    case 'scared': return { left_eye_open: 1.0, right_eye_open: 1.0, mouth_open: 0.35, head_tilt: -6 };
    case 'annoyed': return { left_eye_shape: 0.8, right_eye_shape: 0.8, mouth_open: 0.0, head_tilt: 5 };
    case 'sleepy': return { left_eye_open: 0.12, right_eye_open: 0.12, mouth_open: 0.05 };
    default: return {};
  }
}

const PARAM_IDS: Record<string, string> = {
  head_turn_x: 'ParamAngleX',
  head_turn_y: 'ParamAngleY',
  head_tilt: 'ParamAngleZ',
  left_eye_open: 'ParamEyeLOpen',
  right_eye_open: 'ParamEyeROpen',
  left_eye_smile: 'ParamEyeLSmile',
  right_eye_smile: 'ParamEyeRSmile',
  left_eye_shape: 'ParamEyeLForm',
  right_eye_shape: 'ParamEyeRForm',
  gaze_x: 'ParamEyeBallX',
  gaze_y: 'ParamEyeBallY',
  mouth_open: 'ParamMouthOpenY',
};

function valueOf(params: Record<string, number>, key: string, fallback: number): number {
  const v = params[key];
  return v === undefined ? fallback : v;
}

export class Live2DAvatar implements AvatarProvider {
  private app: any = null;
  private model: any = null;
  private currentAction = '';
  private expr = 'neutral';
  private params: AvatarParams = { speed: 0, head_angle: 0 };
  private arousal = 0;
  private valence = 0;

  constructor(private container: HTMLElement) {}

  async load(): Promise<void> {
    const w = window as unknown as { __flypetStatus?: string };
    const say = (s: string) => { w.__flypetStatus = s; };
    try {
      const canvas = document.createElement('canvas');
      canvas.width = this.container.clientWidth || 420;
      canvas.height = this.container.clientHeight || 470;
      this.container.appendChild(canvas);
      say('pixi-init');
      this.app = new PIXI.Application({ view: canvas, backgroundAlpha: 0, autoStart: true, resizeTo: this.container });
      say('pixi-ready');
      const Live2DModel = PIXI.live2d.Live2DModel;
      say('model-loading');
      this.model = await Live2DModel.from(MODEL_URL, {
        autoInteract: false,
        autoUpdate: true,
        motionPreload: 'IDLE',
      });
      say('model-loaded');
      // fit: bottom-center, ~92% of window height (anchor bottom-center)
      this.model.anchor.set(0.5, 1);
      const scale = ((this.container.clientHeight || 470) * 0.92) / this.model.internalModel.height;
      this.model.scale.set(scale);
      this.model.x = (this.container.clientWidth || 420) / 2;
      this.model.y = this.container.clientHeight || 470;
      this.app.stage.addChild(this.model);
      this.app.ticker.add(() => this.applyFrame());
      this.setAction('idle');
      say('ready');
    } catch (err) {
      say(`error: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
      throw err;
    }
  }

  setAction(avatar: string): void {
    if (!this.model || avatar === this.currentAction) return;
    this.currentAction = avatar;
    const target = ACTION_MOTION[avatar];
    if (target) {
      this.model.motion(target[0], target[1], 2 /*FORCE*/).catch(() => { /* missing motion is fine */ });
    } else {
      this.model.motion('Idle', 0, 2).catch(() => { /* noop */ });
    }
  }

  setExpression(expr: string, arousal: number, valence: number): void {
    this.expr = expr;
    this.arousal = arousal;
    this.valence = valence;
  }

  setParams(params: AvatarParams): void {
    this.params = params;
  }

  /** Written every tick so idle-motion breathing does not overwrite them. */
  private applyFrame(): void {
    if (!this.model) return;
    const core = this.model.internalModel.coreModel;
    const set = (alias: string, value: number) => {
      const id = PARAM_IDS[alias];
      if (id) core.setParameterValueById(id, value);
    };
    const t = performance.now() / 1000;

    this.applyWalk(t);
    this.applyIdleLife(t, set);

    const preset = expressionParams(this.expr);
    for (const [alias, value] of Object.entries(preset)) set(alias, value);
    const blink = this.blink;
    if (blink < 1) {
      // blinks override whatever the expression preset says about the eyes
      set('left_eye_open', Math.min(valueOf(preset, 'left_eye_open', 0.75 + 0.25 * this.arousal), this.blink));
      set('right_eye_open', Math.min(valueOf(preset, 'right_eye_open', 0.75 + 0.25 * this.arousal), this.blink));
    } else if (this.expr === 'neutral') {
      const open = 0.75 + 0.25 * this.arousal;
      set('left_eye_open', open);
      set('right_eye_open', open);
    }
  }

  /**
   * Walking read: bob + lean synced to the window's real velocity. The model
   * has no directional walk cycle, so the bounce carries the "steps".
   */
  private applyWalk(t: number): void {
    const moving = this.params.moving === true;
    const h = this.container.clientHeight || 470;
    if (!moving) {
      this.model.rotation = 0;
      this.model.y = h;
      return;
    }
    const speed = Math.max(0.15, Math.min(1, this.params.speed || 0.4));
    const rate = 5.5 + 7 * speed;                        // steps per second
    const bob = Math.abs(Math.sin(t * rate * Math.PI));
    this.model.y = h - bob * h * (0.015 + 0.025 * speed);
    this.model.rotation = Math.sign(this.params.vx || 1) * (0.03 + 0.04 * speed);
  }

  private applyIdleLife(t: number, set: (alias: string, value: number) => void): void {
    set('head_turn_x', this.params.head_angle + (1 - this.arousal) * 3.5 * Math.sin(t * 0.7));
    set('gaze_x', this.params.head_angle / 25);
    set('head_turn_y', 2.0 * Math.sin(t * 0.5 + 1.3) * (1 - this.arousal * 0.7));
    set('breath', 0.5 + 0.4 * Math.sin(t * 2.1));   // ParamBreath if the model has it
    if (this.expr === 'content' && this.valence > 0.5) set('head_tilt', 3); // sweet spot
  }

  private get blink(): number {
    const t = performance.now() / 1000;
    if (this.expr === 'sleepy') return 1; // sleepy keeps its preset lids
    if (t < this._nextBlink) return 1;
    const phase = (t - this._nextBlink) / 0.24;
    if (phase >= 1) {
      this._nextBlink = t + 2 + Math.random() * 4;
      return 1;
    }
    return Math.max(0.05, Math.abs(1 - 2 * phase));
  }
  private _nextBlink = performance.now() / 1000 + 2 + Math.random() * 3;

}
