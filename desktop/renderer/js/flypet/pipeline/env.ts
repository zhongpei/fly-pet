/**
 * FlyPet adapter for the NyaDeskPet Live2D pipeline (copied verbatim into
 * pipeline/): provides the window.* services the manager expects —
 * logger, settingsManager, backendClient (tap_event/model_info routing),
 * dialogueManager — mapped onto the FlyPet brain bridge.
 */
import { logger } from './logger.js';

export const MODEL_URL = '../models/live2d/mao_pro_zh/runtime/mao_pro.model3.json';

export function initPipelineEnv(handlers: {
  onTap: () => void;
  onDialogue: (text: string, duration?: number) => void;
}): void {
  const w = window as unknown as Record<string, unknown>;

  w.logger = logger;

  w.settingsManager = {
    getSettings: () => ({ modelPath: MODEL_URL, enableEyeTracking: true }),
    getCurrentTapConfig: () => ({
      Head: { enabled: true, description: 'head' },
      Body: { enabled: true, description: 'body' },
    }),
  };

  // the manager reports model_info / tap_event through backendClient.sendMessage;
  // the real client returns a promise (the manager chains .catch on it), so
  // this shim must too
  w.backendClient = {
    sendMessage: (msg: { type: string; data?: { part?: string } }) => {
      if (msg.type === 'tap_event') handlers.onTap();
      return Promise.resolve();
    },
  };

  w.dialogueManager = {
    showDialogue: (text: string, duration?: number) => handlers.onDialogue(text, duration),
  };
}

export { logger };
