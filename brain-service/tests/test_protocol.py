from brain_service.protocol import AVATAR_ACTION_MAP, BrainAction, SensoryEvent, SensoryKind


def test_avatar_map_covers_all_actions():
    assert set(AVATAR_ACTION_MAP) == {a.value for a in BrainAction}
    assert len(set(AVATAR_ACTION_MAP.values())) == len(AVATAR_ACTION_MAP)


def test_sensory_event_from_message():
    ev = SensoryEvent.from_message({"kind": "mouse_move", "x": -0.7, "speed": 120.0})
    assert ev.kind is SensoryKind.MOUSE_MOVE
    assert ev.side == "C"
    assert ev.x == -0.7
