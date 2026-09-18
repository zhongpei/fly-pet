import brain_service.nya_map as nya_map


def test_action_motion_covers_all_avatar_states():
    for avatar in ("idle", "walk", "walk_left", "walk_right", "run", "jump",
                   "back", "groom", "wander", "look", "waving", "display",
                   "sleep", "rest", "threat", "turn_away"):
        cmd = nya_map.motion_command(avatar)
        assert cmd["command"] == "motion"


def test_dialogue_line_known_and_unknown_actions():
    assert nya_map.dialogue_line("THREAT") in nya_map.ACTION_LINES["THREAT"]
    assert nya_map.dialogue_line("IDLE") == ""


def test_event_lines_exist_for_touch_feelings():
    for key in ("head_pat", "petting", "held"):
        assert nya_map.EVENT_LINES[key]


def test_effect_commands_flash_then_auto_revert():
    jump = nya_map.effect_command("jump")
    ids = {p["id"] for p in jump["parameters"]}
    assert "ParamExplosionOn" in ids
    for p in jump["parameters"]:
        assert p["duration"] > 0      # the manager auto-reverts after duration
    assert nya_map.effect_command("idle") is None


def test_heart_command_for_petting():
    heart = nya_map.heart_command()
    ids = {p["id"] for p in heart["parameters"]}
    assert "ParamHeartHealOn" in ids


def test_expression_files_are_real_decoded_set():
    for expr, fid in nya_map.EXPRESSION_FILE.items():
        assert fid.startswith("exp_")


def test_moving_actions_play_idle_not_gestures():
    for avatar in ("walk", "walk_left", "walk_right", "approach", "run",
                   "jump", "back", "wander"):
        group, _ = nya_map.ACTION_MOTION[avatar]
        assert group == "Idle", f"{avatar} must not act while moving"


def test_gesture_motions_are_force_priority():
    for avatar in ("waving", "threat", "groom", "display"):
        assert nya_map.motion_command(avatar)["priority"] == 3
    assert nya_map.motion_command("idle")["priority"] == 2


def test_body_leans_follow_walk_direction_not_head_angle():
    cmd = nya_map.param_command("MOVE_RIGHT", {"speed": 0.5, "head_angle": -25.0, "dir": 1.0}, t=0.4)
    allx = next(p for p in cmd["parameters"] if p["id"] == "ParamAllX")
    assert allx["value"] > 0                    # lean INTO travel, head says left
    rotate = next(p for p in cmd["parameters"] if p["id"] == "ParamAllRotate")
    assert rotate["value"] > 0                  # body faces travel


def test_stationary_action_has_no_walk_bob():
    cmd = nya_map.param_command("idle", {"speed": 0.5, "head_angle": 0.0, "dir": 0.0}, t=0.4)
    ids = {p["id"] for p in cmd["parameters"]}
    assert "ParamAllY" not in ids and "ParamAllX" not in ids


def test_turn_away_rotates_without_window_move():
    cmd = nya_map.param_command("turn_away", {"speed": 0.0, "head_angle": 0.0, "dir": -1.0}, t=0.4)
    rotate = next(p for p in cmd["parameters"] if p["id"] == "ParamAllRotate")
    assert rotate["value"] < 0
    ids = {p["id"] for p in cmd["parameters"]}
    assert "ParamAllY" not in ids               # no walking bob
