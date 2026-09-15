import { MODEL_URL, initPipelineEnv } from './pipeline/env.js';
import './pipeline/live2d-manager.js';
import './pipeline/response-controller.js';
const ACTION_MOTION = {
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
const EXPRESSION_FILE = {
    neutral: 'exp_01',
    content: 'exp_02',
    sleepy: 'exp_03',
    curious: 'exp_04',
    scared: 'exp_07',
    annoyed: 'exp_08',
    alert: 'exp_07',
};
function expressionExtras(expr) {
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
export class ManagedLive2DAvatar {
    constructor(container) {
        this.container = container;
        this.expr = 'neutral';
        this.params = { speed: 0, head_angle: 0, moving: false, vx: 0 };
        this.bobTimer = null;
        this.bobPhase = 0;
        this.started = false;
        this.walking = false;
    }
    async load() {
        window.__flypetLoadStep = 'env';
        initPipelineEnv({
            onTap: () => window.flypetTap?.(),
            onDialogue: (text) => this.showBubble(text),
        });
        const mgr = window.live2dManager;
        window.__flypetLoadStep = 'initialize';
        await mgr.initialize();
        window.__flypetLoadStep = 'loadModel';
        const ok = await mgr.loadModel(MODEL_URL);
        window.__flypetLoadStep = `loadModel=${ok}`;
        if (!ok)
            throw new Error('loadModel returned false');
        window.__flypetLoadStep = 'eyeTracking';
        mgr.enableEyeTracking(true);
        window.__flypetLoadStep = 'started';
        this.started = true;
        this.setAction('idle');
    }
    setAction(avatar) {
        if (!this.started)
            return;
        const target = ACTION_MOTION[avatar];
        if (target)
            window.live2dManager.playMotion(target[0], target[1], 2);
        else
            window.live2dManager.playMotion('Idle', 0, 2);
        this.walking = WALKING_AVATARS.has(avatar);
        if (this.walking && this.bobTimer === null) {
            this.bobTimer = window.setInterval(() => this.bobStep(), 120);
        }
        else if (!this.walking && this.bobTimer !== null) {
            window.clearInterval(this.bobTimer);
            this.bobTimer = null;
            window.live2dManager.setParameters([
                { id: 'ParamAllY', value: 0, blend: 0.5, duration: 0.2 },
                { id: 'ParamAllX', value: 0, blend: 0.5, duration: 0.25 },
                { id: 'ParamBodyAngleZ', value: 0, blend: 0.5, duration: 0.25 },
            ]);
        }
    }
    setExpression(expr, _arousal, _valence) {
        if (!this.started || expr === this.expr)
            return;
        this.expr = expr;
        window.live2dManager.setExpression(EXPRESSION_FILE[expr] ?? 'exp_01');
        window.live2dManager.setParameters(expressionExtras(expr));
    }
    setParams(p) {
        this.params = p;
        if (!this.started)
            return;
        window.live2dManager.setParameters([
            { id: 'ParamAngleX', value: Math.max(-25, Math.min(25, p.head_angle)), blend: 0.4, duration: 0.1 },
            { id: 'ParamEyeBallX', value: Math.max(-1, Math.min(1, p.head_angle / 25)), blend: 0.4, duration: 0.1 },
        ]);
    }
    bobStep() {
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
    showBubble(text) {
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
