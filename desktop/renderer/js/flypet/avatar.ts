/**
 * AvatarProvider contract shared by the sprite and Live2D renderers.
 * Actions come from brain_service AVATAR_ACTION_MAP; expression + params
 * are the V1 continuous/emotional output layer (docs/v1-plan.md).
 */
export interface AvatarParams {
  speed: number;      // 0..1 forward-walking rate
  head_angle: number; // -25..25 deg, from DNa02 asymmetry
}

export interface AvatarProvider {
  load(): Promise<void>;
  setAction(avatar: string): void;
  setExpression(expr: string, arousal: number, valence: number): void;
  setParams(params: AvatarParams): void;
}
