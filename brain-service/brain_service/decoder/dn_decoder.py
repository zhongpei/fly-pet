"""Action decoder: descending-neuron rates -> BrainAction (+ continuous params).

Hand-coded biological mapping, V1 (docs/v1-plan.md). All thresholds calibrated
against measured MaleCNS dose-response curves (scripts/calibrate_results):
direct-drive channels fire_from ~0.4 (16.7 Hz) and saturate ~25 Hz, baselines
are 0-4 Hz, so 10-14 Hz thresholds separate cleanly.

Priority (high -> low):
    DNp01 burst          -> JUMP (short) / AVOID (sustained)   [urgent]
    pIP10                -> THREAT
    MDN                  -> BACK
    DNa02 asymmetry      -> MOVE_LEFT / MOVE_RIGHT
    DNg100 + mouse       -> APPROACH
    petting              -> INTERACT (calm wave, no approach)
    recent click         -> INTERACT
    DNa03 asymmetry      -> TURN_AWAY          [speculative]
    DNp10                -> WING_DISPLAY       [speculative]
    DNg01                -> GROOM              [speculative]
    idle timer + rng     -> WANDER
    mouse in memory      -> LOOK
    quiet brain + desk   -> REST

Rates are EMA-smoothed and every transition needs a short confirmation window
(hysteresis), except urgent actions (JUMP/AVOID/THREAT/BACK) which interrupt
immediately.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field

from ..protocol import BrainAction, now
from ..sensory.encoder import SensoryEncoder


@dataclass
class DecoderConfig:
    # thresholds calibrated on measured MaleCNS rates (scripts/calibrate_result.json)
    ema: float = 0.35                 # rate smoothing per decision (~50 Hz steps)
    avoid_rate: float = 12.0          # Hz, DNp01 above this escapes
    jump_max: float = 0.40            # s, DNp01 bursts shorter than this = startle
    threat_rate: float = 12.0         # Hz, pIP10
    back_rate: float = 12.0           # Hz, MDN
    steer_margin: float = 2.5         # Hz, |DNa02 L-R| needed to turn
    forward_rate: float = 6.0         # Hz, DNg100 forward walking
    display_rate: float = 12.0        # Hz, DNp10 (baseline 4 Hz -> stays above it)
    groom_rate: float = 10.0          # Hz, DNg01 pool
    turnaway_margin: float = 3.5      # Hz, DNa03 asymmetry
    quiet_rate: float = 2.5           # Hz, total DN rate below this counts as quiet
    rest_after: float = 25.0          # seconds of dual quiet before REST
    confirm_seconds: float = 0.20     # non-urgent changes must hold this long
    interact_hold: float = 2.0        # a click stays interactable this long
    wander_after: float = 8.0         # idle seconds before a wander may start
    wander_span: tuple = (2.0, 4.5)   # wander duration range, seconds
    speculative: bool = True          # TURN_AWAY / WING_DISPLAY / GROOM (named
                                      # channels, exploratory behaviour reading;
                                      # set False for literature-only strictness)


@dataclass
class DecoderState:
    action: BrainAction = BrainAction.IDLE
    candidate: BrainAction | None = None
    candidate_since: float = 0.0
    last_change: float = 0.0
    smoothed: dict[str, float] = field(default_factory=dict)
    dn01_since: float | None = None    # DNp01 burst start, for JUMP/AVOID split
    idle_since: float = 0.0
    wander_until: float = 0.0
    wander_dir: float = 1.0
    escape_dir: float = 1.0            # last non-centred mouse side, for escapes
    params: dict[str, float] = field(default_factory=dict)


class ActionDecoder:
    def __init__(self, encoder: SensoryEncoder, cfg: DecoderConfig | None = None,
                 seed: int = 11) -> None:
        self.cfg = cfg or DecoderConfig()
        self.encoder = encoder
        self.state = DecoderState(idle_since=now())
        self._rng = random.Random(seed)

    # ---- action selection --------------------------------------------------

    def _evaluate(self, rates: dict[str, float], total: float, t: float) -> BrainAction:
        cfg, enc = self.cfg, self.encoder

        # 1. giant fiber: startle (short burst) or escape (sustained)
        dn01 = max(rates.get("DNp01_L", 0.0), rates.get("DNp01_R", 0.0))
        if dn01 >= cfg.avoid_rate:
            if self.state.dn01_since is None:
                self.state.dn01_since = t
            return BrainAction.JUMP if t - self.state.dn01_since < cfg.jump_max else BrainAction.AVOID
        self.state.dn01_since = None

        if rates.get("pIP10_L", 0.0) >= cfg.threat_rate or rates.get("pIP10_R", 0.0) >= cfg.threat_rate:
            return BrainAction.THREAT
        if rates.get("MDN", 0.0) >= cfg.back_rate:
            return BrainAction.BACK

        steer = rates.get("DNa02_L", 0.0) - rates.get("DNa02_R", 0.0)
        if not enc.petting() and abs(steer) >= cfg.steer_margin:
            return BrainAction.MOVE_LEFT if steer > 0 else BrainAction.MOVE_RIGHT

        if not enc.petting() and rates.get("DNg100", 0.0) >= cfg.forward_rate and enc.mouse_recent():
            return BrainAction.APPROACH

        if enc.petting():
            return BrainAction.INTERACT
        if enc.recent_touch(cfg.interact_hold):
            return BrainAction.INTERACT

        if cfg.speculative:
            t03 = rates.get("DNa03_L", 0.0) - rates.get("DNa03_R", 0.0)
            if abs(t03) >= cfg.turnaway_margin and abs(steer) < cfg.steer_margin:
                return BrainAction.TURN_AWAY
            if rates.get("DNp10_L", 0.0) >= cfg.display_rate or rates.get("DNp10_R", 0.0) >= cfg.display_rate:
                return BrainAction.WING_DISPLAY
            if rates.get("DNg01", 0.0) >= cfg.groom_rate:
                return BrainAction.GROOM

        if t < self.state.wander_until:
            return BrainAction.WANDER
        if enc.mouse_recent():
            return BrainAction.LOOK

        if total < cfg.quiet_rate and enc.desktop_quiet_since() >= cfg.rest_after:
            return BrainAction.REST
        return BrainAction.IDLE

    def update(self, activity) -> tuple[BrainAction, bool]:
        """Feed one step of activity; returns (action, changed)."""
        cfg = self.cfg
        st = self.state
        t = now()

        for k, v in activity.rates.items():
            prev = st.smoothed.get(k, v)
            st.smoothed[k] = prev + cfg.ema * (v - prev)
        smooth_total = sum(st.smoothed.values())
        self._update_params(st, smooth_total)
        want = self._evaluate(st.smoothed, smooth_total, t)
        urgent = want in (BrainAction.AVOID, BrainAction.JUMP, BrainAction.THREAT, BrainAction.BACK)

        if want is not st.action:
            if urgent:
                st.action, st.last_change, st.candidate = want, t, None
            elif want is st.candidate:
                if t - st.candidate_since >= cfg.confirm_seconds:
                    st.action, st.last_change, st.candidate = want, t, None
            else:
                st.candidate, st.candidate_since = want, t
        else:
            st.candidate = None

        # wander scheduler: when nothing is happening, occasionally stroll
        if st.action in (BrainAction.IDLE, BrainAction.LOOK):
            if st.idle_since == 0.0:
                st.idle_since = t
            elif t - st.idle_since > cfg.wander_after and t >= st.wander_until:
                if self._rng.random() < 0.004:  # ~once per 5 idle seconds
                    st.wander_until = t + self._rng.uniform(*cfg.wander_span)
                    st.wander_dir = self._rng.choice((-1.0, 1.0))
                    st.idle_since = t
        else:
            st.idle_since = 0.0
            if st.action is not BrainAction.WANDER:
                st.wander_until = 0.0
        return st.action, st.last_change == t

    def _update_params(self, st: DecoderState, smooth_total: float) -> None:
        """Continuous output layer (docs/v1-plan.md section 3)."""
        s = st.smoothed
        st.params = {
            "speed": max(0.0, min(1.0, s.get("DNg100", 0.0) / 30.0)),
            "head_angle": max(-25.0, min(25.0, (s.get("DNa02_L", 0.0) - s.get("DNa02_R", 0.0)) * 1.2)),
            "intensity": max(0.0, min(1.0, smooth_total / 120.0)),
            "dir": self._direction(st),
        }

    def _direction(self, st: DecoderState) -> float:
        """Signed walk direction in {-1, 0, +1}: THE single source of truth for
        both the window walker and the model's body lean/rotation, so the body
        can never lean against the direction the window travels.
        APPROACH moves toward the cursor, escapes away, WANDER keeps the
        direction it picked when the stroll started."""
        a, enc = st.action, self.encoder
        mx = enc.mouse_x()
        toward = 1.0 if mx > 0.05 else -1.0 if mx < -0.05 else 0.0

        if a is BrainAction.MOVE_LEFT:
            return -1.0
        if a is BrainAction.MOVE_RIGHT:
            return 1.0
        if a is BrainAction.APPROACH:
            return toward
        if a in (BrainAction.AVOID, BrainAction.JUMP, BrainAction.BACK):
            if toward != 0.0:
                st.escape_dir = toward
            return -st.escape_dir
        if a is BrainAction.WANDER:
            return st.wander_dir
        if a is BrainAction.TURN_AWAY:
            if toward != 0.0:
                st.escape_dir = toward
            return -st.escape_dir   # face away from the cursor
        return 0.0
