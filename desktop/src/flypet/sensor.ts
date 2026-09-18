/**
 * FlyPet desktop sensor: turn global cursor motion into semantic sensory
 * events (docs/dev.md section 10). Pure logic — the caller feeds it cursor
 * samples and window bounds, it emits protocol messages.
 */

export interface SensoryMsg {
  type: 'sensory_event';
  kind: string;
  side?: 'L' | 'R' | 'C';
  x?: number;
  speed?: number;
  cls?: string;   // touch semantics: head | body
  ts: number;
}

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export interface SensorOptions {
  radius?: number;        // px that maps to normalized x = +-1 (default 420)
  approachSpeed?: number; // px/s closing speed that counts as looming (default 350)
  moveEmitMs?: number;    // min interval between mouse_move events (default 90)
}

export class CursorSensor {
  private last: Point | null = null;
  private lastT = 0;
  private lastMoveSent = 0;
  private radius: number;
  private approachSpeed: number;
  private moveEmitMs: number;

  constructor(opts: SensorOptions = {}) {
    this.radius = opts.radius ?? 420;
    this.approachSpeed = opts.approachSpeed ?? 350;
    this.moveEmitMs = opts.moveEmitMs ?? 90;
  }

  /** Feed one cursor sample; returns the events it should produce, if any. */
  poll(cursor: Point, win: Rect, nowMs: number): SensoryMsg[] {
    const cx = win.x + win.width / 2;
    const cy = win.y + win.height / 2;
    const dx = cursor.x - cx;
    const dy = cursor.y - cy;
    const dist = Math.hypot(dx, dy);
    const events: SensoryMsg[] = [];

    if (this.last) {
      const dt = Math.max(1, nowMs - this.lastT) / 1000;
      const prevDist = Math.hypot(this.last.x - cx, this.last.y - cy);
      const closing = (prevDist - dist) / dt; // px/s, positive when approaching

      const moved = Math.hypot(cursor.x - this.last.x, cursor.y - this.last.y);
      if (moved > 2 && nowMs - this.lastMoveSent >= this.moveEmitMs) {
        this.lastMoveSent = nowMs;
        events.push(this.event('mouse_move', {
          x: clamp(dx / this.radius, -1, 1),
          side: sideOf(dx),
        }));
      }
      if (closing > this.approachSpeed && dist < this.radius * 1.6) {
        events.push(this.event('mouse_approach', { speed: Math.round(closing), side: sideOf(dx) }));
      }
    }
    this.last = { ...cursor };
    this.lastT = nowMs;
    return events;
  }

  private event(kind: string, extra: { x?: number; speed?: number; side?: 'L' | 'R' | 'C' }): SensoryMsg {
    return { type: 'sensory_event', kind, ts: Date.now() / 1000, ...extra };
  }
}

function sideOf(dx: number): 'L' | 'R' | 'C' {
  return dx < -30 ? 'L' : dx > 30 ? 'R' : 'C';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
