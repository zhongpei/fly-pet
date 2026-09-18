"""Emotion layer: arousal x valence -> expression states + internal drives.

The connectome has no plasticity, so "feelings" live here (V1 heuristic);
what reaches the brain are internal drives injected into calibrated command
neurons (pIP10 for threat, MDN for retreat, ...), so actions still emerge
through the brain and the DN decoder rather than being declared directly.

  arousal  fast-attack / slow-decay EMA of brain activity + sensory energy
  valence  event accumulator with decay (petting/food up, looming/pokes down)
  drives   internal channel strengths returned per step (threat/groom/...)
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from .protocol import Expression, now


@dataclass
class EmotionConfig:
    arousal_attack: float = 0.25     # per update (fast)
    arousal_decay: float = 0.03      # per update (slow)
    valence_decay: float = 0.02      # per second toward 0
    annoy_window: float = 12.0       # seconds of click history for annoyance
    annoy_clicks: int = 3            # clicks in window that start to annoy
    petting_valence: float = 0.35    # per second of petting
    threat_drive: float = 0.6
    groom_drive: float = 0.5
    display_drive: float = 0.5
    retreat_drive: float = 0.55
    groom_every: tuple = (25.0, 60.0)   # random idle interval, seconds
    display_every: tuple = (30.0, 90.0)  # when content
    speculative: bool = True         # gates groom/display drives (exploratory)


@dataclass
class EmotionState:
    arousal: float = 0.0
    valence: float = 0.0
    expression: Expression = Expression.NEUTRAL
    drives: dict[str, float] = field(default_factory=dict)
    annoyance: int = 0
    debug: dict = field(default_factory=dict)


class EmotionEngine:
    def __init__(self, cfg: EmotionConfig | None = None, seed: int = 3) -> None:
        self.cfg = cfg or EmotionConfig()
        self._rng = random.Random(seed)
        self.state = EmotionState()
        self._click_times: list[float] = []
        self._petting: bool = False
        self._petting_since: float | None = None
        self._next_groom = now() + self._rng.uniform(*self.cfg.groom_every)
        self._next_display = now() + self._rng.uniform(*self.cfg.display_every)
        self._drive_until: dict[str, float] = {}

    # ---- events ----------------------------------------------------------

    def on_click(self) -> None:
        t = now()
        self._click_times = [x for x in self._click_times if t - x < self.cfg.annoy_window]
        self._click_times.append(t)
        self.state.annoyance = len(self._click_times)
        self.add_valence(-0.05)  # each poke stings a little

    def on_head_pat(self) -> None:
        """A tap on the head: social grooming contact. Soothing - the opposite
        of a body poke (valence up, one annoyance click forgiven)."""
        t = now()
        if self._click_times:
            self._click_times.pop(0)   # a pat calms one poke of irritation
        self.state.annoyance = len(self._click_times)
        self.add_valence(0.12)
        self._hold("_groom", 1.2)      # a little face-rub reaction

    def on_held(self) -> None:
        """Grabbed: strong aversive contact, then resignation."""
        self.add_valence(-0.15)
        self._hold("_retreat", 0.9)    # struggle (MDN backward walking)
        self._hold("_threat", 0.6)     # and a wing flick

    def on_petting(self, active: bool) -> None:
        self._petting = active
        self._petting_since = now() if active else None

    def add_valence(self, amount: float) -> None:
        self.state.valence = max(-1.0, min(1.0, self.state.valence + amount))

    # ---- per-step update ---------------------------------------------------

    def update(self, total_rate: float, sensory_energy: float, resting: bool) -> EmotionState:
        cfg, st = self.cfg, self.state
        target = min(1.0, (total_rate / 120.0) + sensory_energy)
        rate = cfg.arousal_attack if target > st.arousal else cfg.arousal_decay
        st.arousal += rate * (target - st.arousal)

        if self._petting and self._petting_since is not None:
            held = now() - self._petting_since
            st.valence = min(1.0, st.valence + self.cfg.petting_valence * 0.016)  # per step
            if held > 1.2:
                st.valence = min(1.0, st.valence + 0.002)
            if held > 10.0:  # safety: a lost release must not pet forever
                self.on_petting(False)
        st.valence -= cfg.valence_decay * 0.016 * abs(st.valence)  # decay toward 0
        st.annoyance = len([x for x in self._click_times if now() - x < cfg.annoy_window])
        st.expression = self._expression(resting)
        st.drives = self._drives()
        st.debug = {
            "click_times": len(self._click_times),
            "threat_hold_s": round(max(0.0, self._drive_until.get("_threat", 0) - now()), 2),
            "petting_engine": self._petting,
            "oldest_click_age": round(now() - min(self._click_times), 1) if self._click_times else None,
        }
        return st

    def _expression(self, resting: bool) -> Expression:
        st = self.state
        if resting or (st.arousal < 0.08 and st.valence <= 0):
            return Expression.SLEEPY
        if st.valence <= -0.35 and st.arousal > 0.45:
            return Expression.SCARED
        if st.annoyance >= self.cfg.annoy_clicks and st.valence < 0.2:
            return Expression.ANNOYED
        if st.arousal > 0.55 and st.valence >= -0.1:
            return Expression.CURIOUS if st.valence > 0.15 else Expression.ALERT
        if st.valence > 0.3:
            return Expression.CONTENT
        return Expression.NEUTRAL

    def _drives(self) -> dict[str, float]:
        """Internal drives injected into calibrated command neurons. Actions
        (THREAT/GROOM/...) still have to emerge through the DN decoder."""
        cfg, st = self.cfg, self.state
        t = now()
        drives: dict[str, float] = {}

        if st.annoyance >= cfg.annoy_clicks + 1 and st.valence < 0.1:
            self._hold("_threat", 1.2)
        if st.valence < -0.45 and st.arousal < 0.5:
            self._hold("_retreat", 0.8)
        if not self._petting and t > self._next_groom:
            self._next_groom = t + self._rng.uniform(*cfg.groom_every)
            self._hold("_groom", 2.5)
        if st.valence > 0.55 and t > self._next_display:
            self._next_display = t + self._rng.uniform(*cfg.display_every)
            self._hold("_display", 1.2)

        if now() < self._drive_until.get("_threat", 0):
            d = cfg.threat_drive
            drives.update(threat_L=d, threat_R=d)
        if now() < self._drive_until.get("_retreat", 0):
            d = cfg.retreat_drive
            drives.update(retreat_L=d, retreat_R=d)
        if not cfg.speculative:
            return drives
        if now() < self._drive_until.get("_groom", 0):
            d = cfg.groom_drive
            drives.update(groom_L=d, groom_R=d)
        if now() < self._drive_until.get("_display", 0):
            d = cfg.display_drive
            drives.update(display_L=d, display_R=d)
        return drives

    def _hold(self, key: str, seconds: float) -> None:
        """Set an absolute deadline (NOT cumulative: called every step while the
        condition holds, adding would balloon the hold into minutes)."""
        self._drive_until[key] = max(now() + seconds, self._drive_until.get(key, 0))
