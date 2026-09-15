"""BrainBackend contract (docs/dev.md section 12).

The product must not be bound to fly.ai (it has no plasticity). Everything the
rest of the system touches goes through this interface:

    reset()                  silence the brain
    step(stimuli)            advance one simulation step
    get_activity()           current descending-neuron rates + total activity
    save_state() / load_state()

`stimuli` is a list of (channel_name, strength) pairs; the backend maps
channels onto its own neuron populations.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass, field

from .protocol import DN_CHANNELS, SENSORY_CHANNELS


@dataclass
class StepInfo:
    """Bookkeeping for one simulation step."""

    sim_t: float = 0.0          # simulated time in seconds
    wall_dt: float = 0.0        # real time the step took
    fired: int = 0              # neurons that spiked this step


@dataclass
class BrainActivity:
    rates: dict[str, float] = field(default_factory=dict)     # DN_CHANNELS -> Hz
    sensory_rate: dict[str, float] = field(default_factory=dict)  # optional
    total: float = 0.0                                        # whole-brain spike rate (Hz)


class BrainBackend(abc.ABC):
    """A step-advancing brain. All methods are called from the brain thread only."""

    name: str = "backend"

    @abc.abstractmethod
    def reset(self) -> None: ...

    @abc.abstractmethod
    def step(self, stimuli: list[tuple[str, float]]) -> StepInfo: ...

    @abc.abstractmethod
    def get_activity(self) -> BrainActivity: ...

    @abc.abstractmethod
    def save_state(self, path: str) -> None: ...

    @abc.abstractmethod
    def load_state(self, path: str) -> None: ...

    def info(self) -> dict:
        return {"backend": self.name, "channels": list(SENSORY_CHANNELS), "dn": list(DN_CHANNELS)}


def empty_activity() -> BrainActivity:
    return BrainActivity(
        rates={k: 0.0 for k in DN_CHANNELS},
        sensory_rate={k: 0.0 for k in SENSORY_CHANNELS},
    )
