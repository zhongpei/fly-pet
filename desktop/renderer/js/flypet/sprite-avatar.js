const AVATAR_TO_STATE = {
    idle: { state: 'idle' },
    walk_left: { state: 'runningLeft', interval: 170 },
    walk_right: { state: 'runningRight', interval: 170 },
    walk: { state: 'running', interval: 150 },
    run: { state: 'running', interval: 70 },
    look: { state: 'review' },
    waving: { state: 'waving' },
    sleep: { state: 'failed', interval: 380 },
};
export class SpriteAvatar {
    constructor(el) {
        this.el = el;
        this.img = new Image();
        this.char = null;
        this.stateName = 'idle';
        this.interval = 900;
        this.frame = 0;
        this.acc = 0;
        this.lastT = 0;
        this.ready = false;
    }
    async load(baseUrl) {
        const char = await this.loadJson(baseUrl);
        this.char = char;
        await new Promise((resolve, reject) => {
            this.img.onload = () => resolve();
            this.img.onerror = () => reject(new Error(`sprite load failed: ${this.img.src}`));
            this.img.src = `${baseUrl}${char.sprite}`;
        });
        this.ready = true;
        this.setAction('idle');
        requestAnimationFrame((t) => this.tick(t));
    }
    loadJson(baseUrl) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', `${baseUrl}character.json`);
            xhr.onload = () => {
                if (xhr.status === 0 || xhr.status === 200) {
                    try {
                        resolve(JSON.parse(xhr.responseText));
                    }
                    catch (e) {
                        reject(new Error(`bad character.json: ${String(e)}`));
                    }
                }
                else {
                    reject(new Error(`character.json HTTP ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error(`cannot load ${baseUrl}character.json`));
            xhr.send();
        });
    }
    setAction(avatar) {
        if (!this.char)
            return;
        const mapping = AVATAR_TO_STATE[avatar] ?? AVATAR_TO_STATE.idle;
        const st = this.char.states[mapping.state] ?? this.char.states.idle;
        const interval = mapping.interval ?? st.interval;
        if (mapping.state === this.stateName && interval === this.interval)
            return;
        this.stateName = mapping.state;
        this.interval = interval;
        this.frame = 0;
        this.acc = 0;
        this.apply();
    }
    apply() {
        if (!this.char)
            return;
        const st = this.char.states[this.stateName] ?? this.char.states.idle;
        const w = this.char.frame.width;
        const h = this.char.frame.height;
        this.el.style.width = `${w}px`;
        this.el.style.height = `${h}px`;
        this.el.style.backgroundImage = `url("${this.img.src}")`;
        this.el.style.backgroundRepeat = 'no-repeat';
        this.el.style.backgroundPosition = `-${this.frame * w}px -${st.row * h}px`;
    }
    tick(t) {
        if (this.lastT === 0)
            this.lastT = t;
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
    get isReady() {
        return this.ready;
    }
}
