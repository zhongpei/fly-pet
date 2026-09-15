"""Wire protocol shared by brain-service, the desktop shell and the Brain Lab.

All messages are JSON with a `type` field, following the NyaDeskPet convention.

Client -> service:
    {"type": "sensory_event", "kind": "...", "side": "L"|"R"|"C",
     "x": float, "speed": float, "ts": float}
    {"type": "ping"}

Service -> clients:
    {"type": "welcome", ...}
    {"type": "brain_state", "action": "...", "changed": bool, ...}
    {"type": "brain_telemetry", ...}   (throttled to ~10 Hz)
    {"type": "pong"}
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


class BrainAction(str, Enum):
    """The eight V0 actions the brain can command (docs/dev.md section 9)."""

    IDLE = "IDLE"
    MOVE_LEFT = "MOVE_LEFT"
    MOVE_RIGHT = "MOVE_RIGHT"
    APPROACH = "APPROACH"
    AVOID = "AVOID"
    LOOK = "LOOK"
    INTERACT = "INTERACT"
    REST = "REST"


class SensoryKind(str, Enum):
    """The eight V0 desktop sensory events (docs/dev.md section 10)."""

    MOUSE_MOVE = "mouse_move"        # cursor present/moving, side + proximity in x
    MOUSE_APPROACH = "mouse_approach"  # cursor closing fast -> looming
    PET_CLICK = "pet_click"          # user clicked the pet -> touch
    PET_DRAG = "pet_drag"            # user drags the pet around
    OBJECT_APPEAR = "object_appear"  # a virtual object shows up -> odour
    OBJECT_REMOVE = "object_remove"
    IDLE_TICK = "idle_tick"          # desktop quiet
    TIME_TICK = "time_tick"          # 1 Hz heartbeat


# BrainAction -> avatar animation state (character.json state names for the
# SpriteAvatar, motion aliases for Live2D).
AVATAR_ACTION_MAP: dict[str, str] = {
    BrainAction.IDLE.value: "idle",
    BrainAction.MOVE_LEFT.value: "walk_left",
    BrainAction.MOVE_RIGHT.value: "walk_right",
    BrainAction.APPROACH.value: "walk",
    BrainAction.AVOID.value: "run",
    BrainAction.LOOK.value: "look",
    BrainAction.INTERACT.value: "waving",
    BrainAction.REST.value: "sleep",
}

# Sensory channels injected into the brain. Values are per-step strengths in
# [0, 1]; each backend maps a channel to real neuron populations.
SENSORY_CHANNELS = (
    "chase_L", "chase_R",   # LC10a, moving target on one side
    "loom_L", "loom_R",     # LC4 + LPLC2, looming on one side
    "touch_L", "touch_R",   # somatosensory, pet touched
    "odor",                 # ORN population, virtual object present
)

# Descending-neuron populations tracked for the decoder and the Brain Lab.
DN_CHANNELS = (
    "DNp01_L", "DNp01_R",   # giant fiber, escape
    "DNa02_L", "DNa02_R",   # steering
    "DNg100",               # forward walking
    "MDN",                  # backward walking
)


@dataclass
class SensoryEvent:
    kind: SensoryKind
    side: str = "C"          # "L", "R" or "C" (centre / both)
    x: float = 0.0           # -1 far left .. +1 far right, relative to the pet
    speed: float = 0.0       # px/s towards the pet, for MOUSE_APPROACH
    ts: float = field(default_factory=time.time)

    @classmethod
    def from_message(cls, msg: dict) -> "SensoryEvent":
        return cls(
            kind=SensoryKind(msg["kind"]),
            side=msg.get("side", "C"),
            x=float(msg.get("x", 0.0)),
            speed=float(msg.get("speed", 0.0)),
            ts=float(msg.get("ts", time.time())),
        )


def now() -> float:
    return time.monotonic()
