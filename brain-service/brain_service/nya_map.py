"""NyaDeskPet backend-protocol mapping: brain output -> renderer commands.

The reference renderer (desktop/renderer, index.html + renderer.ts +
live2d-manager) speaks the protocol documented in desktop/docs/API.md.
FlyPet mode runs that renderer verbatim and this module translates brain
output into the messages it already understands:

    action  -> {"command": "motion", ...}
    emotion -> {"command": "expression", ...} + mouth/brow parameters
    params  -> {"command": "parameter", "parameters": [...]} batches

Expression files decoded from models/live2d/mao_pro_zh/runtime/expressions:
    exp_01 normal, exp_02 laughing eyes, exp_03 closed, exp_04 sparkle,
    exp_06 blush, exp_07 wide, exp_08 angry.
"""
from __future__ import annotations

import time

# BrainAction avatar name -> [motion group, index] (mao_pro: Idle + 6 generic)
ACTION_MOTION: dict[str, tuple[str, int]] = {
    "idle": ("Idle", 0),
    "sleep": ("Idle", 0),
    "rest": ("Idle", 0),
    "look": ("", 1),
    "waving": ("", 0),
    "walk": ("", 2),
    "walk_left": ("", 2),
    "walk_right": ("", 2),
    "approach": ("", 2),
    "run": ("", 3),
    "jump": ("", 3),
    "threat": ("", 3),
    "back": ("", 4),
    "groom": ("", 4),
    "wander": ("", 5),
    "turn_away": ("", 5),
    "display": ("", 0),
}

EXPRESSION_FILE: dict[str, str] = {
    "neutral": "exp_01",
    "content": "exp_02",   # laughing eyes (EyeLOpen=0, Smile=1)
    "sleepy": "exp_03",    # eyes closed
    "curious": "exp_04",   # sparkle eyes (EyeLOpen=1.2 + Smile)
    "alert": "exp_07",     # wide open
    "scared": "exp_07",
    "annoyed": "exp_08",   # angry eye form (EyeL/RForm=1)
}

# actions that move the window -> the model reads as walking
MOVING_ACTIONS = {"MOVE_LEFT", "MOVE_RIGHT", "APPROACH", "AVOID", "BACK", "WANDER", "JUMP"}

EMOTION_EXTRAS: dict[str, list[tuple[str, float]]] = {
    "annoyed": [("ParamMouthAngry", 1.0), ("ParamBrowLForm", 1.0), ("ParamBrowRForm", 1.0)],
    "content": [("ParamMouthUp", 0.8), ("ParamCheek", 0.6)],
    "scared": [("ParamMouthOpenY", 0.35)],
    "curious": [("ParamMouthUp", 0.4)],
    "sleepy": [("ParamMouthOpenY", 0.05)],
}


def motion_command(avatar: str) -> dict:
    group, index = ACTION_MOTION.get(avatar, ("Idle", 0))
    return {"command": "motion", "group": group, "index": index, "priority": 2}


def expression_command(expr: str) -> dict:
    return {"command": "expression", "expressionId": EXPRESSION_FILE.get(expr, "exp_01")}


def emotion_param_command(expr: str) -> dict:
    extras = [{"id": pid, "value": v, "blend": 0.8, "duration": 0.25}
              for pid, v in EMOTION_EXTRAS.get(expr, [])]
    return {"command": "parameter", "parameters": extras}


def param_command(action: str, params: dict, t: float | None = None) -> dict:
    """Continuous batch: head turn + eye gaze + walking bob/lean.

    t=None means stationary batching (no walk oscillation)."""
    t = time.monotonic() if t is None else t
    speed = max(0.15, min(1.0, params.get("speed") or 0.0))
    head = max(-25.0, min(25.0, params.get("head_angle") or 0.0))
    moving = action in MOVING_ACTIONS
    out = [
        {"id": "ParamAngleX", "value": head, "blend": 0.4, "duration": 0.1},
        {"id": "ParamEyeBallX", "value": head / 25.0, "blend": 0.4, "duration": 0.1},
    ]
    if moving:
        rate = 5.5 + 7 * speed
        bob = abs((t * rate) % 2 - 1)          # triangle bob 0..1
        lean = 1.0 if head >= 0 else -1.0
        out += [
            {"id": "ParamAllY", "value": -bob * (1.5 + 2.5 * speed), "blend": 0.5, "duration": 0.1},
            {"id": "ParamAllX", "value": lean * (2.5 + 4 * speed), "blend": 0.5, "duration": 0.1},
            {"id": "ParamBodyAngleZ", "value": lean * (2 + 3 * speed), "blend": 0.5, "duration": 0.1},
        ]
    return {"command": "parameter", "parameters": out}


def commands_for(action: str, avatar: str, emotion: str, params: dict, t: float | None = None) -> list[dict]:
    """All live2d `data` payloads for one broadcast tick."""
    cmds: list[dict] = []
    cmds.append(motion_command(avatar))
    cmds.append(expression_command(emotion))
    extras = emotion_param_command(emotion)
    if extras.get("parameters"):
        cmds.append(extras)
    cmds.append(param_command(action, params, t))
    return cmds
