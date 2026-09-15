"""In-memory telemetry ring buffer + 10 Hz sampler for the Brain Lab."""
from __future__ import annotations

import collections
import time
from dataclasses import dataclass


@dataclass
class Sample:
    wall_t: float
    sim_t: float
    action: str
    rates: dict[str, float]
    fired: int
    steps_per_s: float


class Telemetry:
    def __init__(self, maxlen: int = 600) -> None:
        self._buf: collections.deque[Sample] = collections.deque(maxlen=maxlen)

    def push(self, sample: Sample) -> None:
        self._buf.append(sample)

    def recent(self, seconds: float = 10.0) -> list[Sample]:
        cutoff = time.monotonic() - seconds
        return [s for s in self._buf if s.wall_t >= cutoff]

    def snapshot(self, seconds: float = 10.0) -> dict:
        rows = self.recent(seconds)
        return {
            "window": seconds,
            "samples": [
                {
                    "t": round(s.wall_t, 3),
                    "sim_t": round(s.sim_t, 3),
                    "action": s.action,
                    "rates": {k: round(v, 2) for k, v in s.rates.items()},
                    "fired": s.fired,
                    "sps": round(s.steps_per_s, 1),
                }
                for s in rows
            ],
        }
