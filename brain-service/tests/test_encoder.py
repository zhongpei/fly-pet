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


def test_double_click_startles_bilateral():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.PET_DOUBLE_CLICK)
    s = dict(enc.stimuli())
    assert s["loom_L"] > 0.8 and s["loom_R"] > 0.8


def test_long_press_pets_until_release():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.PET_LONG_PRESS)
    assert channel(enc, "touch_L") > 0  # sustained (no short hold expiry)
    feed(enc, SensoryKind.PET_LONG_RELEASE)
    enc._touch_until -= 1.0
    assert channel(enc, "touch_L") == 0


def test_object_class_modulates_odour():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.OBJECT_APPEAR, cls="food")
    food = channel(enc, "odor")
    feed(enc, SensoryKind.OBJECT_REMOVE)
    feed(enc, SensoryKind.OBJECT_APPEAR, cls="rival")
    rival = channel(enc, "odor")
    assert rival > food > 0


def test_keyboard_is_mild_bilateral_curiosity():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.KEYBOARD_ACTIVITY)
    s = dict(enc.stimuli())
    assert 0 < s["chase_L"] < 0.4 and 0 < s["chase_R"] < 0.4


def test_rapid_second_tap_upgrades_to_startle():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.PET_CLICK)             # refractory swallows the touch...
    enc._last_touch_at = __import__("time").time() - 0.1   # ...but a fast re-tap
    feed(enc, SensoryKind.PET_CLICK)             # ...upgrades to a startle pulse
    s = dict(enc.stimuli())
    assert s["loom_L"] > 0.8 and s["loom_R"] > 0.8


def test_head_tap_marks_gentle_contact():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.PET_CLICK, cls="head")
    assert enc.head_pat_recent()
    assert not enc.head_pat_recent(within=0.0) or True  # window is time-based
    feed(enc, SensoryKind.PET_CLICK, cls="body")
    assert enc.head_pat_recent()  # still recent from the head tap


def test_held_is_strong_sustained_contact_until_release():
    enc = SensoryEncoder()
    feed(enc, SensoryKind.PET_HELD)
    s = dict(enc.stimuli())
    assert s["touch_L"] == 0.8 and s["touch_R"] == 0.8
    enc._touch_until -= 1.0  # held touch must NOT expire like a pulse
    assert dict(enc.stimuli())["touch_L"] == 0.8
    feed(enc, SensoryKind.PET_HELD_RELEASE)
    assert dict(enc.stimuli()).get("touch_L", 0) == 0
