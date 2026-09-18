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

# Motion mapping, decoded from the actual motion files (docs/connection-plan.md):
#   mtn_01 = gentle idle/breathing loop (group "Idle")
#   mtn_02 = both arms raised, cheer/display (3.5s)
#   mtn_03 = head-shake wiggle (4.4s)
#   mtn_04 = arm swat + hat flourish (4.2s)
#   special_01..03 = 7.8-9.4s magic performances (explosion/heart/rabbit) — too
#     long and theatrical for locomotion; reserved, not mapped.
# Moving behaviours get NO gesture (the model has no walk cycle): the window
# step + AllY bob + physics sway carry the movement, exactly like the original
# NyaDeskPet, whose pet never moves at all. Only stationary behaviours act.
ACTION_MOTION: dict[str, tuple[str, int]] = {
    "idle": ("Idle", 0),
    "sleep": ("Idle", 0),
    "rest": ("Idle", 0),
    "look": ("Idle", 0),          # looking is done by the head/eye params
    "waving": ("", 0),            # INTERACT: arms-up cheer
    "walk": ("Idle", 0),
    "walk_left": ("Idle", 0),
    "walk_right": ("Idle", 0),
    "approach": ("Idle", 0),
    "run": ("Idle", 0),
    "jump": ("Idle", 0),          # the Explosion parameter flash is the startle
    "threat": ("", 2),            # mtn_04: aggressive swat
    "back": ("Idle", 0),
    "groom": ("", 1),             # mtn_03: wiggle-clean
    "wander": ("Idle", 0),
    "turn_away": ("Idle", 0),     # turns via the AllRotate parameter instead
    "display": ("", 0),           # mtn_02: wings/arms-up display
}

# One-shot gestures must interrupt whatever is playing (pixi-live2d-display
# priority 3 = FORCE); idle-ish switches stay at NORMAL (2) and simply lose if
# a gesture is mid-flight.
GESTURE_AVATARS = {"waving", "threat", "groom", "display"}

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

# ---- dialogue: the brain speaks its state (rendered by the reference bubble) --
ACTION_LINES: dict[str, list[str]] = {
    "MOVE_LEFT": ["往这边走走", "咦，那边有什么"],
    "MOVE_RIGHT": ["往那边逛逛", "溜达溜达～"],
    "APPROACH": ["让我看看～", "靠近一点"],
    "AVOID": ["好险好险！", "别过来！"],
    "LOOK": ["在看什么呢", "嗯？"],
    "INTERACT": ["一起玩吧！", "嘿嘿～"],
    "REST": ["累了，歇一会儿", "zzz……"],
    "JUMP": ["呀！！", "吓我一跳！"],
    "BACK": ["退后、退后", "离我远一点"],
    "THREAT": ["别戳我！", "哼！生气了！"],
    "WING_DISPLAY": ["听我唱歌：嗡嗡嗡", "看我的翅膀～"],
    "GROOM": ["理理毛，梳梳妆", "干干净净最重要"],
    "TURN_AWAY": ["哼，不想理你了", "（转过身去）"],
    "WANDER": ["随便逛逛～", "那边好像有味道"],
}

# event lines (touch feelings), sent once when the event starts
EVENT_LINES: dict[str, list[str]] = {
    "head_pat": ["再摸摸~", "呼……好舒服"],
    "petting": ["……好舒服，别停", "呼噜呼噜……"],
    "held": ["哇！放开我！", "救命，被抓到了！"],
}

# ---- magic effects: one-shot param flashes (blend+duration auto-reverts) ------
# avatar name -> [(param id, value, duration s)]  (mao_pro effect parameter sets)
EFFECT_PARAMS: dict[str, list[tuple[str, float, float]]] = {
    "jump": [("ParamExplosionOn", 1.0, 0.7), ("ParamExplosion", 1.0, 0.7)],
    "threat": [("ParamStrengthenLightOn", 1.0, 1.1), ("ParamStrengthenLight", 1.0, 1.1)],
    "display": [("ParamAuraOn", 1.0, 1.4), ("ParamAura", 1.0, 1.4)],
    "run": [("ParamSmokeOn", 1.0, 0.6), ("ParamSmoke", 1.0, 0.6)],
}
# petting a fly feels good: the heart-heal spell
PET_HEART: list[tuple[str, float, float]] = [
    ("ParamHeartHealOn", 1.0, 1.5), ("ParamHeartDrow", 1.0, 1.5), ("ParamHeartSize", 1.0, 1.5),
]


def effect_command(avatar: str) -> dict | None:
    spec = EFFECT_PARAMS.get(avatar)
    if not spec:
        return None
    return {"command": "parameter",
            "parameters": [{"id": pid, "value": v, "blend": 1.0, "duration": d}
                           for pid, v, d in spec]}


def heart_command() -> dict:
    return {"command": "parameter",
            "parameters": [{"id": pid, "value": v, "blend": 1.0, "duration": d}
                           for pid, v, d in PET_HEART]}


def dialogue_line(action: str) -> str:
    """Pick a line for an action ("" if the action has nothing to say)."""
    import random
    lines = ACTION_LINES.get(action)
    return random.choice(lines) if lines else ""


def motion_command(avatar: str) -> dict:
    group, index = ACTION_MOTION.get(avatar, ("Idle", 0))
    priority = 3 if avatar in GESTURE_AVATARS else 2
    return {"command": "motion", "group": group, "index": index, "priority": priority}


def expression_command(expr: str) -> dict:
    return {"command": "expression", "expressionId": EXPRESSION_FILE.get(expr, "exp_01")}


def emotion_param_command(expr: str) -> dict:
    extras = [{"id": pid, "value": v, "blend": 0.8, "duration": 0.25}
              for pid, v in EMOTION_EXTRAS.get(expr, [])]
    return {"command": "parameter", "parameters": extras}


def param_command(action: str, params: dict, t: float | None = None) -> dict:
    """Continuous batch: head turn + eye gaze + walking bob/lean/turn.

    Movement direction comes from params["dir"] (the decoder's signed {-1,0,1}
    output) — the SAME source the window walker uses, so the body can never
    lean against the direction of travel. The bob is kept below 4.5 Hz because
    the parameter stream runs at 10 Hz (anything faster aliases into noise).

    t=None means stationary batching (no walk oscillation)."""
    t = time.monotonic() if t is None else t
    speed = max(0.15, min(1.0, params.get("speed") or 0.0))
    head = max(-25.0, min(25.0, params.get("head_angle") or 0.0))
    dirn = 1 if params.get("dir", 0) > 0 else -1 if params.get("dir", 0) < 0 else 0
    out = [
        {"id": "ParamAngleX", "value": head, "blend": 0.4, "duration": 0.1},
        {"id": "ParamEyeBallX", "value": head / 25.0, "blend": 0.4, "duration": 0.1},
    ]
    if action == "turn_away" and dirn != 0:
        # no window movement: turn the body away from the cursor instead
        out.append({"id": "ParamAllRotate", "value": dirn * 10.0, "blend": 0.6, "duration": 0.3})
        return {"command": "parameter", "parameters": out}
    if action in MOVING_ACTIONS and dirn != 0:
        rate = 2.2 + 2.3 * speed                     # 2.5-4.5 Hz step/bob rate
        bob = abs((t * rate) % 2 - 1)                # triangle bob 0..1
        out += [
            {"id": "ParamAllY", "value": -bob * (2.5 + 3.0 * speed), "blend": 0.5, "duration": 0.1},
            {"id": "ParamAllX", "value": dirn * (3.0 + 4.0 * speed), "blend": 0.5, "duration": 0.1},
            {"id": "ParamBodyAngleZ", "value": dirn * (2.5 + 3.5 * speed), "blend": 0.5, "duration": 0.1},
            {"id": "ParamAllRotate", "value": dirn * (3.0 + 2.0 * speed), "blend": 0.5, "duration": 0.1},
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
