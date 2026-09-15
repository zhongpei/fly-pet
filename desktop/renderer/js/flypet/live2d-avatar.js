const MODEL_URL = '../models/live2d/mao_pro_zh/runtime/mao_pro.model3.json';
const ACTION_MOTION = {
    walk: ['', 0],
    run: ['', 1],
    walk_left: ['', 2],
    walk_right: ['', 3],
    back: ['', 4],
    wander: ['', 5],
    jump: ['Idle', 0],
    threat: ['', 1],
    display: ['', 2],
    groom: ['', 4],
    waving: ['', 2],
    look: ['', 3],
};
function expressionParams(expr) {
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
const PARAM_IDS = {
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
function valueOf(params, key, fallback) {
    const v = params[key];
    return v === undefined ? fallback : v;
}
export class Live2DAvatar {
    constructor(container) {
        this.container = container;
        this.app = null;
        this.model = null;
        this.currentAction = '';
        this.expr = 'neutral';
        this.params = { speed: 0, head_angle: 0 };
        this.arousal = 0;
        this.valence = 0;
        this._nextBlink = performance.now() / 1000 + 2 + Math.random() * 3;
    }
    async load() {
        const w = window;
        const say = (s) => { w.__flypetStatus = s; };
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
            this.model.anchor.set(0.5, 1);
            const scale = ((this.container.clientHeight || 470) * 0.92) / this.model.internalModel.height;
            this.model.scale.set(scale);
            this.model.x = (this.container.clientWidth || 420) / 2;
            this.model.y = this.container.clientHeight || 470;
            this.app.stage.addChild(this.model);
            this.app.ticker.add(() => this.applyFrame());
            this.setAction('idle');
            say('ready');
        }
        catch (err) {
            say(`error: ${String(err?.message ?? err).slice(0, 160)}`);
            throw err;
        }
    }
    setAction(avatar) {
        if (!this.model || avatar === this.currentAction)
            return;
        this.currentAction = avatar;
        const target = ACTION_MOTION[avatar];
        if (target) {
            this.model.motion(target[0], target[1], 2).catch(() => { });
        }
        else {
            this.model.motion('Idle', 0, 2).catch(() => { });
        }
    }
    setExpression(expr, arousal, valence) {
        this.expr = expr;
        this.arousal = arousal;
        this.valence = valence;
    }
    setParams(params) {
        this.params = params;
    }
    applyFrame() {
        if (!this.model)
            return;
        const core = this.model.internalModel.coreModel;
        const set = (alias, value) => {
            const id = PARAM_IDS[alias];
            if (id)
                core.setParameterValueById(id, value);
        };
        const t = performance.now() / 1000;
        this.applyWalk(t);
        this.applyIdleLife(t, set);
        const preset = expressionParams(this.expr);
        for (const [alias, value] of Object.entries(preset))
            set(alias, value);
        const blink = this.blink;
        if (blink < 1) {
            set('left_eye_open', Math.min(valueOf(preset, 'left_eye_open', 0.75 + 0.25 * this.arousal), this.blink));
            set('right_eye_open', Math.min(valueOf(preset, 'right_eye_open', 0.75 + 0.25 * this.arousal), this.blink));
        }
        else if (this.expr === 'neutral') {
            const open = 0.75 + 0.25 * this.arousal;
            set('left_eye_open', open);
            set('right_eye_open', open);
        }
    }
    applyWalk(t) {
        const moving = this.params.moving === true;
        const h = this.container.clientHeight || 470;
        if (!moving) {
            this.model.rotation = 0;
            this.model.y = h;
            return;
        }
        const speed = Math.max(0.15, Math.min(1, this.params.speed || 0.4));
        const rate = 5.5 + 7 * speed;
        const bob = Math.abs(Math.sin(t * rate * Math.PI));
        this.model.y = h - bob * h * (0.02 + 0.035 * speed);
        this.model.rotation = Math.sign(this.params.vx || 1) * (0.03 + 0.04 * speed);
    }
    applyIdleLife(t, set) {
        set('head_turn_x', this.params.head_angle + (1 - this.arousal) * 3.5 * Math.sin(t * 0.7));
        set('gaze_x', this.params.head_angle / 25);
        set('head_turn_y', 2.0 * Math.sin(t * 0.5 + 1.3) * (1 - this.arousal * 0.7));
        set('breath', 0.5 + 0.4 * Math.sin(t * 2.1));
        if (this.expr === 'content' && this.valence > 0.5)
            set('head_tilt', 3);
    }
    get blink() {
        const t = performance.now() / 1000;
        if (this.expr === 'sleepy')
            return 1;
        if (t < this._nextBlink)
            return 1;
        const phase = (t - this._nextBlink) / 0.24;
        if (phase >= 1) {
            this._nextBlink = t + 2 + Math.random() * 4;
            return 1;
        }
        return Math.max(0.05, Math.abs(1 - 2 * phase));
    }
}
