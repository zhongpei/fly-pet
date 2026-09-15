from brain_service.sensory.encoder import SensoryEncoder
from brain_service.protocol import SensoryEvent, SensoryKind


def feed(enc, kind, **kw):
    enc.feed(SensoryEvent(kind=kind, **kw))


def channel(enc, name):
    return dict(enc.stimuli()).get(name, 0.0)


def test_mouse_left_drives_left_chase():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.MOUSE_MOVE, x=-0.8)
    stim = dict(enc.stimuli())
    assert stim.get("chase_L", 0) > 0
    assert stim.get("chase_R", 0) == 0


def test_near_cursor_is_stronger_chase():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.MOUSE_MOVE, x=-0.1)
    near = channel(enc, "chase_L")
    feed(enc, SensoryKind.MOUSE_MOVE, x=-0.9)
    far = channel(enc, "chase_L")
    assert near > far


def test_fast_approach_becomes_looming_then_fades():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.MOUSE_APPROACH, side="R", speed=600.0)
    assert channel(enc, "loom_R") > 0
    enc._loom_until -= 1.0  # force the hold window to expire
    assert channel(enc, "loom_R") == 0


def test_click_pulses_touch_with_refractory():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.PET_CLICK)
    assert channel(enc, "touch_L") > 0 and channel(enc, "touch_R") > 0
    feed(enc, SensoryKind.PET_CLICK)  # inside refractory: ignored
    enc._touch_until -= 1.0
    assert channel(enc, "touch_L") == 0


def test_object_smell_persists_until_removal():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.OBJECT_APPEAR)
    assert channel(enc, "odor") > 0
    feed(enc, SensoryKind.OBJECT_REMOVE)
    assert channel(enc, "odor") == 0
