"""Wire protocol shared by brain-service, the desktop shell and the Brain Lab.

All messages are JSON with a `type` field, following the NyaDeskPet convention.

Client -> service:
    {"type": "sensory_event", "kind": "...", "side": "L"|"R"|"C",
     "x": float, "speed": float, "cls": "food"|"rival"|"toy", "ts": float}
    {"type": "ping"}

Service -> clients:
    {"type": "welcome", ...}
    {"type": "brain_state", "action": "...", "avatar": "...", "intensity": 0..1,
     "expression": "...", "params": {"speed": 0..1, "head_angle": -30..30}}
    {"type": "brain_emotion", "arousal": 0..1, "valence": -1..1, "state": "..."}
    {"type": "brain_telemetry", ...}   (throttled to ~10 Hz)
    {"type": "pong"}
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


class BrainAction(str, Enum):
    """Actions the brain can command. V1: biology-first vocabulary
    (docs/v1-plan.md); `speculative` ones are config-gated in the decoder."""

    IDLE = "IDLE"
    MOVE_LEFT = "MOVE_LEFT"
    MOVE_RIGHT = "MOVE_RIGHT"
    APPROACH = "APPROACH"
    AVOID = "AVOID"
    LOOK = "LOOK"
    INTERACT = "INTERACT"
    REST = "REST"
    # --- V1 additions ---
    JUMP = "JUMP"                    # DNp01 short pulse (startle)
    BACK = "BACK"                    # MDN
    THREAT = "THREAT"                # pIP10 (male wing-threat command neuron)
    WING_DISPLAY = "WING_DISPLAY"    # DNp10
    GROOM = "GROOM"                  # DNg01/DNg09 population (speculative)
    TURN_AWAY = "TURN_AWAY"          # DNa03 (speculative)
    WANDER = "WANDER"                # spontaneous network activity


class SensoryKind(str, Enum):
    """Desktop sensory events (V0 eight + V1 additions)."""

    MOUSE_MOVE = "mouse_move"        # cursor present/moving, side + proximity in x
    MOUSE_APPROACH = "mouse_approach"  # cursor closing fast -> looming
    PET_CLICK = "pet_click"          # user clicked the pet -> touch
    PET_DOUBLE_CLICK = "pet_double_click"  # startle -> sharp DNp01 pulse
    PET_LONG_PRESS = "pet_long_press"      # petting (while held)
    PET_LONG_RELEASE = "pet_long_release"  # petting ended
    PET_DRAG = "pet_drag"            # user drags the pet around
    PET_HELD = "pet_held"            # user grabbed the pet (dragging the window)
    PET_HELD_RELEASE = "pet_held_release"  # put back down
    OBJECT_APPEAR = "object_appear"  # virtual object; cls = food|rival|toy
    OBJECT_REMOVE = "object_remove"
    KEYBOARD_ACTIVITY = "keyboard_activity"  # mild curiosity
    IDLE_TICK = "idle_tick"          # desktop quiet
    TIME_TICK = "time_tick"          # 1 Hz heartbeat


class Expression(str, Enum):
    """Emotion states on the valence x arousal plane (docs/v1-plan.md section 4)."""

    NEUTRAL = "neutral"
    CONTENT = "content"      # valence+, low arousal  (petted, fed)
    CURIOUS = "curious"      # valence+, high arousal (chase target around)
    ALERT = "alert"          # arousal spike, valence ~0
    SCARED = "scared"        # valence-, high arousal (DNp01)
    ANNOYED = "annoyed"      # valence-, mid arousal  (pIP10 / poked too often)
    SLEEPY = "sleepy"        # low arousal + REST


# BrainAction -> avatar animation state (character.json state names for the
# SpriteAvatar, motion/parameter targets for Live2D).
AVATAR_ACTION_MAP: dict[str, str] = {
    BrainAction.IDLE.value: "idle",
    BrainAction.MOVE_LEFT.value: "walk_left",
    BrainAction.MOVE_RIGHT.value: "walk_right",
    BrainAction.APPROACH.value: "walk",
    BrainAction.AVOID.value: "run",
    BrainAction.LOOK.value: "look",
    BrainAction.INTERACT.value: "waving",
    BrainAction.REST.value: "sleep",
    BrainAction.JUMP.value: "jump",
    BrainAction.BACK.value: "back",
    BrainAction.THREAT.value: "threat",
    BrainAction.WING_DISPLAY.value: "display",
    BrainAction.GROOM.value: "groom",
    BrainAction.TURN_AWAY.value: "turn_away",
    BrainAction.WANDER.value: "wander",
}

# Sensory channels injected into the brain. Values are per-step strengths in
# [0, 1]; each backend maps a channel to real neuron populations.
#   chase/loom/touch/odor   sensory-route channels (fly.ai validated)
#   threat/display/retreat/groom/turnaway  internal drives: direct injection
#       into calibrated named command neurons (optogenetics-style; see
#       scripts/calibrate_channels.py)
SENSORY_CHANNELS = (
    "chase_L", "chase_R",   # LC10a, moving target on one side
    "loom_L", "loom_R",     # LC4 + LPLC2, looming on one side
    "touch_L", "touch_R",   # somatosensory, pet touched
    "odor",                 # ORN population, virtual object present
    "threat_L", "threat_R", # pIP10 direct drive
    "display_L", "display_R",   # DNp10 direct drive
    "retreat_L", "retreat_R",   # MDN direct drive
    "groom_L", "groom_R",   # DNg01+DNg09 direct drive
    "turnaway_L", "turnaway_R",  # DNa03 direct drive
)

# Descending-neuron populations tracked for the decoder and the Brain Lab.
DN_CHANNELS = (
    "DNp01_L", "DNp01_R",   # giant fiber, escape / startle
    "DNa02_L", "DNa02_R",   # steering
    "DNa03_L", "DNa03_R",   # steering family (turn-away candidate)
    "DNp10_L", "DNp10_R",   # wing display
    "pIP10_L", "pIP10_R",   # wing threat
    "DNg100",               # forward walking
    "DNg01",                # grooming candidate pool
    "DNg09",                # grooming candidate pool
    "MDN",                  # backward walking
)


@dataclass
class SensoryEvent:
    kind: SensoryKind
    side: str = "C"          # "L", "R" or "C" (centre / both)
    x: float = 0.0           # -1 far left .. +1 far right, relative to the pet
    speed: float = 0.0       # px/s towards the pet, for MOUSE_APPROACH
    cls: str = ""            # object class: food | rival | toy
    ts: float = field(default_factory=time.time)

    @classmethod
    def from_message(cls, msg: dict) -> "SensoryEvent":
        return cls(
            kind=SensoryKind(msg["kind"]),
            side=msg.get("side", "C"),
            x=float(msg.get("x", 0.0)),
            speed=float(msg.get("speed", 0.0)),
            cls=str(msg.get("cls", "")),
            ts=float(msg.get("ts", time.time())),
        )


def now() -> float:
    return time.monotonic()
