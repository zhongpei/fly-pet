"""Sensory encoder: desktop events -> per-step stimulation strengths.

Follows fly.ai's own approach (docs/dev.md section 10): no screenshots, no
vision stack; semantic desktop events drive feature-detector populations.

V1 additions: startle (double click), petting (long press), object classes
(food / rival / toy modulate the odour channel), keyboard curiosity.
Internal drives (threat/groom/...) come from the emotion engine, not here.
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
    startle_strength: float = 1.0    # double click: sharp bilateral DNp01 pulse
    startle_hold: float = 0.12
    touch_strength: float = 0.9
    touch_hold: float = 0.12
    touch_refractory: float = 0.5
    petting_strength: float = 0.45   # sustained while long-pressed
    keyboard_strength: float = 0.3
    keyboard_hold: float = 2.0
    odor_strength: float = 0.6       # default; per-class overrides below
    odor_class_strength: dict = None  # {food: 0.5, rival: 0.9, toy: 0.3}
    chase_memory: float = 2.5        # seconds the decoder may keep "mouse seen" alive

    def __post_init__(self):
        if self.odor_class_strength is None:
            self.odor_class_strength = {"food": 0.5, "rival": 0.9, "toy": 0.3}


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
        self._startle_until = -1e9
        self._touch_until = -1e9
        self._last_touch_at = -1e9
        self._last_head_pat_at = -1e9
        self._held = False
        self._petting = False
        self._keyboard_until = -1e9
        self._odor_on = False
        self._odor_strength = self.cfg.odor_strength
        self._object_cls = ""
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
        elif ev.kind is SensoryKind.PET_DOUBLE_CLICK:
            self._startle_until = now() + cfg.startle_hold
        elif ev.kind is SensoryKind.PET_CLICK:
            gap = now() - self._last_touch_at
            if gap >= cfg.touch_refractory:
                self._touch_until = now() + cfg.touch_hold
                self._last_touch_at = now()
                if ev.cls == "head":       # head tap: gentle social contact
                    self._last_head_pat_at = now()
            elif gap < 0.35:               # rapid re-tap inside refractory: startle
                self._startle_until = now() + cfg.startle_hold
        elif ev.kind is SensoryKind.PET_LONG_PRESS:
            self._petting = True
        elif ev.kind is SensoryKind.PET_LONG_RELEASE:
            self._petting = False
        elif ev.kind is SensoryKind.PET_HELD:
            self._held = True              # grabbed: strong sustained contact
        elif ev.kind is SensoryKind.PET_HELD_RELEASE:
            self._held = False
        elif ev.kind is SensoryKind.PET_DRAG:
            self._touch_until = now() + cfg.touch_hold
        elif ev.kind is SensoryKind.OBJECT_APPEAR:
            self._odor_on = True
            self._object_cls = ev.cls
            self._odor_strength = cfg.odor_class_strength.get(ev.cls, cfg.odor_strength)
        elif ev.kind is SensoryKind.OBJECT_REMOVE:
            self._odor_on = False
            self._object_cls = ""
        elif ev.kind is SensoryKind.KEYBOARD_ACTIVITY:
            self._keyboard_until = now() + cfg.keyboard_hold

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

        if t < self._startle_until:
            out.append(("loom_L", cfg.startle_strength))
            out.append(("loom_R", cfg.startle_strength))

        if t < self._loom_until:
            side = self._loom_side if self._loom_side in ("L", "R") else "L"
            out.append((f"loom_{side}", self._loom_strength))

        if self._held:
            out.append(("touch_L", 0.8))   # being grabbed: strong bilateral touch
            out.append(("touch_R", 0.8))
        elif t < self._touch_until:
            out.append(("touch_L", cfg.touch_strength))
            out.append(("touch_R", cfg.touch_strength))
        elif self._petting:
            out.append(("touch_L", cfg.petting_strength))
            out.append(("touch_R", cfg.petting_strength))

        if t < self._keyboard_until:
            out.append(("chase_L", cfg.keyboard_strength))
            out.append(("chase_R", cfg.keyboard_strength))

        if self._odor_on:
            out.append(("odor", self._odor_strength))
        return out

    def sensory_energy(self) -> float:
        """0..1 total drive energy, for the arousal estimate."""
        return min(1.0, sum(s for _ch, s in self.stimuli()) / 1.5)

    # ---- context for the decoder / emotion --------------------------------

    def mouse_recent(self, within: float | None = None) -> bool:
        return now() - self._mouse_seen_at < (within or self.cfg.chase_memory)

    def mouse_side(self) -> str:
        return self._mouse_side

    def mouse_x(self) -> float:
        """Normalized cursor x in [-1, 1], 0.0 when the mouse was never seen."""
        return self._mouse_x if self._mouse_x is not None else 0.0

    def recent_touch(self, within: float = 2.0) -> bool:
        return now() - self._last_touch_at < within

    def petting(self) -> bool:
        return self._petting

    def held(self) -> bool:
        return self._held

    def head_pat_recent(self, within: float = 1.5) -> bool:
        return now() - self._last_head_pat_at < within

    def object_class(self) -> str:
        return self._object_cls if self._odor_on else ""

    def desktop_quiet_since(self) -> float:
        return now() - self._last_event_at
