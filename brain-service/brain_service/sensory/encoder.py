"""Sensory encoder: desktop events -> per-step stimulation strengths.

Follows fly.ai's own approach (docs/dev.md section 10): no screenshots, no
vision stack; semantic desktop events drive feature-detector populations.

    mouse sits left of the pet        -> LC10a left   (chase_L)
    mouse closes in fast              -> LC4 + LPLC2  (loom_L / loom_R)
    pet clicked                       -> touch populations
    virtual object present            -> ORN population (odour)
"""
from __future__ import annotations

from dataclasses import dataclass

from ..protocol import SensoryEvent, SensoryKind, now


@dataclass
class SensoryConfig:
    chase_radius: float = 1.2        # |x| beyond this: too far to care
    chase_base: float = 0.35         # strength when the cursor is simply nearby
    chase_near: float = 0.65         # strength when close
    loom_speed: float = 350.0        # px/s of closing speed that counts as looming
    loom_strength: float = 0.85
    loom_hold: float = 0.25          # seconds a looming pulse stays hot
    touch_strength: float = 0.9
    touch_hold: float = 0.12
    touch_refractory: float = 0.5
    odor_strength: float = 0.6
    chase_memory: float = 2.5        # seconds the decoder may keep "mouse seen" alive


class SensoryEncoder:
    """Stateful: feed() events as they happen, stimuli() once per brain step."""

    def __init__(self, cfg: SensoryConfig | None = None) -> None:
        self.cfg = cfg or SensoryConfig()
        self._mouse_x: float | None = None
        self._mouse_side = "C"
        self._mouse_seen_at = -1e9
        self._loom_side = "C"
        self._loom_until = -1e9
        self._loom_strength = 0.0
        self._touch_until = -1e9
        self._last_touch_at = -1e9
        self._odor_on = False
        self._last_event_at = -1e9

    def feed(self, ev: SensoryEvent) -> None:
        cfg = self.cfg
        self._last_event_at = now()
        if ev.kind is SensoryKind.MOUSE_MOVE:
            self._mouse_x = max(-1.0, min(1.0, ev.x))
            self._mouse_side = "L" if ev.x < -0.05 else "R" if ev.x > 0.05 else "C"
            self._mouse_seen_at = now()
        elif ev.kind is SensoryKind.MOUSE_APPROACH:
            self._loom_side = ev.side if ev.side in ("L", "R") else self._mouse_side
            self._loom_until = now() + cfg.loom_hold
            self._loom_strength = cfg.loom_strength * max(0.4, min(1.5, ev.speed / cfg.loom_speed))
        elif ev.kind is SensoryKind.PET_CLICK:
            if now() - self._last_touch_at >= cfg.touch_refractory:
                self._touch_until = now() + cfg.touch_hold
                self._last_touch_at = now()
        elif ev.kind is SensoryKind.PET_DRAG:
            self._touch_until = now() + cfg.touch_hold
        elif ev.kind is SensoryKind.OBJECT_APPEAR:
            self._odor_on = True
        elif ev.kind is SensoryKind.OBJECT_REMOVE:
            self._odor_on = False

    # ---- per-step output -------------------------------------------------

    def stimuli(self) -> list[tuple[str, float]]:
        """Channels to inject on the current step. Cheap; called at brain rate."""
        cfg, out = self.cfg, []
        t = now()

        if self._mouse_x is not None and t - self._mouse_seen_at < cfg.chase_memory:
            proximity = 1.0 - min(1.0, abs(self._mouse_x) / cfg.chase_radius)
            strength = cfg.chase_base + (cfg.chase_near - cfg.chase_base) * proximity
            side = self._mouse_side if self._mouse_side in ("L", "R") else ("L" if (self._mouse_x or 0) < 0 else "R")
            out.append((f"chase_{side}", strength))

        if t < self._loom_until:
            side = self._loom_side if self._loom_side in ("L", "R") else "L"
            out.append((f"loom_{side}", self._loom_strength))

        if t < self._touch_until:
            out.append(("touch_L", cfg.touch_strength))
            out.append(("touch_R", cfg.touch_strength))

        if self._odor_on:
            out.append(("odor", cfg.odor_strength))
        return out

    # ---- context for the decoder ----------------------------------------

    def mouse_recent(self, within: float | None = None) -> bool:
        return now() - self._mouse_seen_at < (within or self.cfg.chase_memory)

    def mouse_side(self) -> str:
        return self._mouse_side

    def recent_touch(self, within: float = 2.0) -> bool:
        return now() - self._last_touch_at < within

    def desktop_quiet_since(self) -> float:
        return now() - self._last_event_at
