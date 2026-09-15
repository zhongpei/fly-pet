import { logger } from './logger.js';
export const MODEL_URL = '../models/live2d/mao_pro_zh/runtime/mao_pro.model3.json';
export function initPipelineEnv(handlers) {
    const w = window;
    w.logger = logger;
    w.settingsManager = {
        getSettings: () => ({ modelPath: MODEL_URL, enableEyeTracking: true }),
        getCurrentTapConfig: () => ({
            Head: { enabled: true, description: 'head' },
            Body: { enabled: true, description: 'body' },
        }),
    };
    w.backendClient = {
        sendMessage: (msg) => {
            if (msg.type === 'tap_event')
                handlers.onTap();
            return Promise.resolve();
        },
    };
    w.dialogueManager = {
        showDialogue: (text, duration) => handlers.onDialogue(text, duration),
    };
}
export { logger };
