from brain_service.backend import empty_activity
from brain_service.decoder.dn_decoder import ActionDecoder, DecoderConfig
from brain_service.protocol import BrainAction, SensoryEvent, SensoryKind
from brain_service.sensory.encoder import SensoryEncoder


def make_decoder(rest_after=0.0, confirm=0.0):
    enc = SensoryEncoder()
    dec = ActionDecoder(enc, DecoderConfig(ema=1.0, rest_after=rest_after, confirm_seconds=confirm))
    return enc, dec


def settle(dec, activity, max_calls=5):
    """Hysteresis means a new action needs repeated confirmations; run until stable.
    Returns (final action, whether a transition happened at any point)."""
    action, any_change = dec.update(activity)
    for _ in range(max_calls - 1):
        action, changed = dec.update(activity)
        any_change = any_change or changed
    return action, any_change


def act(**rates):
    a = empty_activity()
    a.rates.update({k: 0.0 for k in a.rates})
    a.rates.update(rates)
    a.total = sum(a.rates.values())
    return a


def test_dn_escape_wins_immediately():
    enc, dec = make_decoder()
    action, changed = settle(dec, act(DNp01_L=40.0))
    assert action is BrainAction.AVOID and changed


def test_mdn_backward_counts_as_retreat():
    enc, dec = make_decoder()
    action, _ = settle(dec, act(MDN=30.0))
    assert action is BrainAction.AVOID


def test_steering_asymmetry_turns_left():
    enc, dec = make_decoder()
    action, _ = settle(dec, act(DNa02_L=20.0, DNa02_R=2.0))
    assert action is BrainAction.MOVE_LEFT
    action, _ = settle(dec, act(DNa02_L=2.0, DNa02_R=20.0))
    assert action is BrainAction.MOVE_RIGHT


def test_forward_with_mouse_nearby_approaches():
    enc, dec = make_decoder()
    enc.feed(SensoryEvent(kind=SensoryKind.MOUSE_MOVE, x=-0.5))
    action, _ = settle(dec, act(DNg100=20.0))
    assert action is BrainAction.APPROACH


def test_click_then_low_activity_is_interact():
    enc, dec = make_decoder()
    enc.feed(SensoryEvent(kind=SensoryKind.PET_CLICK))
    action, _ = settle(dec, act())
    assert action is BrainAction.INTERACT


def test_mouse_in_memory_but_calm_is_look():
    enc, dec = make_decoder()
    enc.feed(SensoryEvent(kind=SensoryKind.MOUSE_MOVE, x=0.6))
    action, _ = settle(dec, act())
    assert action is BrainAction.LOOK


def test_quiet_brain_and_quiet_desk_rest():
    enc, dec = make_decoder()
    action, _ = settle(dec, act())
    assert action is BrainAction.REST


def test_busy_brain_without_cues_is_idle():
    enc, dec = make_decoder()
    action, _ = settle(dec, act(DNg100=10.0))  # below forward threshold, no mouse
    assert action is BrainAction.IDLE


def test_hysteresis_requires_confirmation():
    enc, dec = make_decoder(confirm=10.0)
    dec.update(act())  # baseline -> REST/IDLE
    action, changed = dec.update(act(DNa02_L=20.0))
    assert action is not BrainAction.MOVE_LEFT and not changed  # candidate only


def test_avoid_interrupts_interact():
    enc, dec = make_decoder()
    enc.feed(SensoryEvent(kind=SensoryKind.PET_CLICK))
    action, _ = dec.update(act(DNp01_R=40.0))
    assert action is BrainAction.AVOID
