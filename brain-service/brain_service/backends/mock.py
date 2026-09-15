"""A toy brain with the same surface as the real one.

No data, no numba, no 260 MB download: it produces plausible descending-neuron
rates with first-order dynamics so the desktop shell, the decoder and the Brain
Lab can be developed before (or without) the connectome.
"""
from __future__ import annotations

import math
import time

from ..backend import BrainActivity, BrainBackend, StepInfo, empty_activity
from ..protocol import DN_CHANNELS

DT = 0.020

# channel -> (response strength, decay per step)
RESPONSE = {
    "chase_L": ("DNa02_L", 12.0, 0.92),
    "chase_R": ("DNa02_R", 12.0, 0.92),
    "loom_L": ("DNp01_L", 45.0, 0.85),
    "loom_R": ("DNp01_R", 45.0, 0.85),
    "touch_L": ("DNg100", 18.0, 0.90),
    "touch_R": ("DNg100", 18.0, 0.90),
    "odor": ("MDN", 14.0, 0.95),
    "threat_L": ("pIP10_L", 22.0, 0.92),
    "threat_R": ("pIP10_R", 22.0, 0.92),
    "display_L": ("DNp10_L", 20.0, 0.90),
    "display_R": ("DNp10_R", 20.0, 0.90),
    "retreat_L": ("MDN", 20.0, 0.92),
    "retreat_R": ("MDN", 12.0, 0.92),
    "groom_L": ("DNg01", 20.0, 0.90),
    "groom_R": ("DNg01", 12.0, 0.90),
    "turnaway_L": ("DNa03_L", 16.0, 0.92),
    "turnaway_R": ("DNa03_R", 16.0, 0.92),
}


class MockBackend(BrainBackend):
    name = "mock"

    def __init__(self, seed: int = 7) -> None:
        import random

        self._rng = random.Random(seed)
        self._drive: dict[str, float] = {k: 0.0 for k in RESPONSE}
        self._rates = {k: 2.0 for k in DN_CHANNELS}
        self._sim_t = 0.0
        self._saved = None

    def reset(self) -> None:
        self._drive = {k: 0.0 for k in RESPONSE}
        self._rates = {k: 2.0 for k in DN_CHANNELS}
        self._sim_t = 0.0

    def step(self, stimuli: list[tuple[str, float]]) -> StepInfo:
        t0 = time.perf_counter()
        for channel, strength in stimuli:
            if channel in self._drive:
                self._drive[channel] = max(self._drive[channel], strength)
        for channel, (dn, amp, decay) in RESPONSE.items():
            self._drive[channel] *= decay
        self._rates = {k: max(1.5, r * 0.90) for k, r in self._rates.items()}
        for channel, (dn, amp, _decay) in RESPONSE.items():
            self._rates[dn] += self._drive[channel] * amp
            # a touch of cross-talk so the decoder has to discriminate
            other = "DNa02_R" if dn == "DNa02_L" else "DNa02_L"
            if dn.startswith("DNa02"):
                self._rates[other] += self._drive[channel] * amp * 0.15
        self._sim_t += DT
        return StepInfo(sim_t=self._sim_t, wall_dt=time.perf_counter() - t0,
                        fired=int(sum(self._rates.values()) * DT))

    def get_activity(self) -> BrainActivity:
        act = empty_activity()
        jitter = lambda: 1.0 + 0.05 * math.sin(time.monotonic() * 3.0)  # noqa: E731
        act.rates = {k: v * jitter() for k, v in self._rates.items()}
        act.total = sum(act.rates.values())
        return act

    def save_state(self, path: str) -> None:
        self._saved = dict(self._rates)

    def load_state(self, path: str) -> None:
        if self._saved is not None:
            self._rates = dict(self._saved)
