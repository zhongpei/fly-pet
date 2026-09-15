"""Action decoder: descending-neuron rates -> one of eight BrainActions.

Hand-coded biological mapping for V0, no training (docs/dev.md section 11):

    DNp01 high              -> AVOID   (giant fiber, escape)
    MDN high                -> AVOID   (backward walking merges into retreat)
    DNa02 L > R             -> MOVE_LEFT
    DNa02 R > L             -> MOVE_RIGHT
    DNg100 high + mouse     -> APPROACH
    recent click            -> INTERACT
    mouse in sensory memory -> LOOK     (nothing stronger is going on)
    quiet brain + quiet desk-> REST

Rates are EMA-smoothed and every transition needs a short confirmation window
(hysteresis), except AVOID which is allowed to interrupt immediately — a real
giant fiber does not debate.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..protocol import BrainAction, now
from ..sensory.encoder import SensoryEncoder


@dataclass
class DecoderConfig:
    # Thresholds calibrated on measured MaleCNS rates (see
    # brain-service/scripts/verify_result.json): baseline ~0 Hz,
    # loom -> DNp01 +25 Hz, chase -> DNa02 +4.7 Hz, all lateralized.
    ema: float = 0.35                 # rate smoothing per decision (~50 Hz steps)
    avoid_rate: float = 12.0          # Hz, DNp01 above this escapes
    steer_margin: float = 2.5         # Hz, |DNa02 L-R| needed to turn
    forward_rate: float = 6.0         # Hz, DNg100 forward walking
    quiet_rate: float = 2.5           # Hz, total DN rate below this counts as quiet
    rest_after: float = 25.0          # seconds of dual quiet before REST
    confirm_seconds: float = 0.20     # non-urgent changes must hold this long
    interact_hold: float = 2.0        # a click stays interactable this long


@dataclass
class DecoderState:
    action: BrainAction = BrainAction.IDLE
    candidate: BrainAction | None = None
    candidate_since: float = 0.0
    last_change: float = 0.0
    smoothed: dict[str, float] = field(default_factory=dict)


class ActionDecoder:
    def __init__(self, encoder: SensoryEncoder, cfg: DecoderConfig | None = None) -> None:
        self.cfg = cfg or DecoderConfig()
        self.encoder = encoder
        self.state = DecoderState()

    def _evaluate(self, rates: dict[str, float], total: float) -> BrainAction:
        cfg, enc = self.cfg, self.encoder
        if max(rates.get("DNp01_L", 0.0), rates.get("DNp01_R", 0.0)) >= cfg.avoid_rate:
            return BrainAction.AVOID
        if rates.get("MDN", 0.0) >= cfg.avoid_rate * 0.8:
            return BrainAction.AVOID

        steer = rates.get("DNa02_L", 0.0) - rates.get("DNa02_R", 0.0)
        if abs(steer) >= cfg.steer_margin:
            return BrainAction.MOVE_LEFT if steer > 0 else BrainAction.MOVE_RIGHT

        if rates.get("DNg100", 0.0) >= cfg.forward_rate and enc.mouse_recent():
            return BrainAction.APPROACH

        if enc.recent_touch(cfg.interact_hold):
            return BrainAction.INTERACT

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

        want = self._evaluate(st.smoothed, smooth_total)
        urgent = want is BrainAction.AVOID

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
        return st.action, st.last_change == t
