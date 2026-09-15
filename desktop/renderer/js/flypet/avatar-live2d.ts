/**
 * ManagedLive2DAvatar: the FlyPet avatar on top of the NyaDeskPet
 * live2d-manager pipeline (window.live2dManager). All parameter writes go
 * through the manager's override system (blend + duration easing), so brain
 * output coexists with idle motions instead of fighting them.
 */
import type { AvatarParams, AvatarProvider } from './avatar.js';
import { MODEL_URL, initPipelineEnv } from './pipeline/env.js';
// side-effect imports: these modules mount their singletons on window
// (window.live2dManager / window.responseController)
import './pipeline/live2d-manager.js';
import './pipeline/response-controller.js';

declare const window: any;

/** BrainAction avatar name -> [motion group, index] (mao_pro: Idle + 6 generic). */
const ACTION_MOTION: Record<string, [string, number]> = {
  idle: ['Idle', 0],
  sleep: ['Idle', 0],
  look: ['', 1],
  waving: ['', 0],
  walk: ['', 2],
  walk_left: ['', 2],
  walk_right: ['', 2],
  approach: ['', 2],
  run: ['', 3],
  jump: ['', 3],
  threat: ['', 3],
  back: ['', 4],
  groom: ['', 4],
  wander: ['', 5],
  turn_away: ['', 5],
  display: ['', 0],
};

/** emotion -> expression file (decoded from expressions/*.exp3.json). */
const EXPRESSION_FILE: Record<string, string> = {
  neutral: 'exp_01',
  content: 'exp_02',   // 弯成月牙的笑眼
  sleepy: 'exp_03',    // 双眼闭合
  curious: 'exp_04',   // 星星眼（1.2 倍睁眼 + 笑）
  scared: 'exp_07',    // 瞪大眼
  annoyed: 'exp_08',   // 怒目变形
  alert: 'exp_07',
};

/** emotion -> extra mouth/brow/cheek parameters (semantic, from param-map). */
function expressionExtras(expr: string): Array<{ id: string; value: number; blend?: number; duration?: number }> {
  switch (expr) {
    case 'annoyed':
      return [
        { id: 'ParamMouthAngry', value: 1, blend: 0.8, duration: 0.25 },
        { id: 'ParamBrowLForm', value: 1, blend: 0.8, duration: 0.25 },
        { id: 'ParamBrowRForm', value: 1, blend: 0.8, duration: 0.25 },
      ];
    case 'content':
      return [
        { id: 'ParamMouthUp', value: 0.8, blend: 0.8, duration: 0.25 },
        { id: 'ParamCheek', value: 0.6, blend: 0.8, duration: 0.4 },
      ];
    case 'scared':
      return [{ id: 'ParamMouthOpenY', value: 0.35, blend: 0.8, duration: 0.2 }];
    case 'curious':
      return [{ id: 'ParamMouthUp', value: 0.4, blend: 0.6, duration: 0.25 }];
    default:
      return [];
  }
}

const WALKING_AVATARS = new Set(['walk', 'walk_left', 'walk_right', 'run', 'back', 'wander', 'approach']);

export class ManagedLive2DAvatar implements AvatarProvider {
  private expr = 'neutral';
  private params: AvatarParams = { speed: 0, head_angle: 0, moving: false, vx: 0 };
  private bobTimer: number | null = null;
  private bobPhase = 0;
  private started = false;
  private walking = false;

  constructor(private container: HTMLElement) {}

  async load(): Promise<void> {
    (window as unknown as Record<string, string>).__flypetLoadStep = 'env';
    initPipelineEnv({
      onTap: () => window.flypetTap?.(),
      onDialogue: (text) => this.showBubble(text),
    });
    const mgr = window.live2dManager;
    (window as unknown as Record<string, string>).__flypetLoadStep = 'initialize';
    await mgr.initialize();
    (window as unknown as Record<string, string>).__flypetLoadStep = 'loadModel';
    const ok = await mgr.loadModel(MODEL_URL);
    (window as unknown as Record<string, string>).__flypetLoadStep = `loadModel=${ok}`;
    if (!ok) throw new Error('loadModel returned false');
    (window as unknown as Record<string, string>).__flypetLoadStep = 'eyeTracking';
    mgr.enableEyeTracking(true);
    (window as unknown as Record<string, string>).__flypetLoadStep = 'started';
    this.started = true;
    this.setAction('idle');
  }

  setAction(avatar: string): void {
    if (!this.started) return;
    const target = ACTION_MOTION[avatar];
    if (target) window.live2dManager.playMotion(target[0], target[1], 2);
    else window.live2dManager.playMotion('Idle', 0, 2);

    this.walking = WALKING_AVATARS.has(avatar);
    if (this.walking && this.bobTimer === null) {
      this.bobTimer = window.setInterval(() => this.bobStep(), 120);
    } else if (!this.walking && this.bobTimer !== null) {
      window.clearInterval(this.bobTimer);
      this.bobTimer = null;
      // settle back to centre through the override system
      window.live2dManager.setParameters([
        { id: 'ParamAllY', value: 0, blend: 0.5, duration: 0.2 },
        { id: 'ParamAllX', value: 0, blend: 0.5, duration: 0.25 },
        { id: 'ParamBodyAngleZ', value: 0, blend: 0.5, duration: 0.25 },
      ]);
    }
  }

  setExpression(expr: string, _arousal: number, _valence: number): void {
    if (!this.started || expr === this.expr) return;
    this.expr = expr;
    window.live2dManager.setExpression(EXPRESSION_FILE[expr] ?? 'exp_01');
    window.live2dManager.setParameters(expressionExtras(expr));
  }

  /** Continuous layer: head turn + eye gaze, pushed through the override system. */
  setParams(p: AvatarParams): void {
    this.params = p;
    if (!this.started) return;
    window.live2dManager.setParameters([
      { id: 'ParamAngleX', value: Math.max(-25, Math.min(25, p.head_angle)), blend: 0.4, duration: 0.1 },
      { id: 'ParamEyeBallX', value: Math.max(-1, Math.min(1, p.head_angle / 25)), blend: 0.4, duration: 0.1 },
    ]);
  }

  /** Walk read: ParamAllX/AllY/BodyAngleZ step bounce via the override system;
   * hair/robe physics react automatically to the fast AllX/AllY changes. */
  private bobStep(): void {
    const speed = Math.max(0.15, Math.min(1, this.params.speed || 0.4));
    this.bobPhase += 0.55;
    const bob = Math.abs(Math.sin(this.bobPhase * Math.PI));
    const dir = (this.params.vx ?? 0) >= 0 ? 1 : -1;
    window.live2dManager.setParameters([
      { id: 'ParamAllY', value: -bob * (1.2 + 2.2 * speed), blend: 0.5, duration: 0.12 },
      { id: 'ParamAllX', value: dir * (2 + 4 * speed), blend: 0.5, duration: 0.12 },
      { id: 'ParamBodyAngleZ', value: dir * (2 + 3 * speed), blend: 0.5, duration: 0.12 },
    ]);
  }

  /** Small speech bubble for sync_command text / future brain chatter. */
  private showBubble(text: string): void {
    let el = document.getElementById('flypet-bubble');
    if (!el) {
      el = document.createElement('div');
      el.id = 'flypet-bubble';
      el.style.cssText =
        'position:absolute;top:12%;left:50%;transform:translateX(-50%);max-width:70%;' +
        'background:rgba(255,255,255,0.92);color:#333;font:13px/1.4 -apple-system,"PingFang SC",sans-serif;' +
        'padding:8px 12px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.25);z-index:5;';
      this.container.appendChild(el);
    }
    el.textContent = text;
    el.style.display = 'block';
    window.setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}
