import time

from brain_service.decoder.dn_decoder import ActionDecoder, DecoderConfig
from brain_service.backend import empty_activity
from brain_service.protocol import BrainAction, SensoryEvent, SensoryKind
from brain_service.sensory.encoder import SensoryEncoder


def make_decoder(rest_after=0.0, confirm=0.0, **cfg):
    enc = SensoryEncoder()
    dec = ActionDecoder(enc, DecoderConfig(ema=1.0, rest_after=rest_after,
                                           confirm_seconds=confirm, **cfg))
    return enc, dec


def act(**rates):
    a = empty_activity()
    a.rates.update({k: 0.0 for k in a.rates})
    a.rates.update(rates)
    a.total = sum(a.rates.values())
    return a


def settle(dec, activity, max_calls=5):
    """Hysteresis means a new action needs repeated confirmations; run until stable.
    Returns (final action, whether a transition happened at any point)."""
    action, any_change = dec.update(activity)
    for _ in range(max_calls - 1):
        action, changed = dec.update(activity)
        any_change = any_change or changed
    return action, any_change


def test_short_dn01_burst_is_jump():
    enc, dec = make_decoder()
    action, changed = dec.update(act(DNp01_L=40.0))
    assert action is BrainAction.JUMP and changed


def test_sustained_dn01_is_avoid():
    enc, dec = make_decoder()
    dec.update(act(DNp01_L=40.0))          # JUMP at burst start
    dec.state.dn01_since = time.monotonic() - 0.5  # the burst keeps going
    action, _ = dec.update(act(DNp01_L=40.0))
    assert action is BrainAction.AVOID


def test_zero_jump_window_means_avoid():
    enc, dec = make_decoder(jump_max=0.0)
    action, changed = settle(dec, act(DNp01_L=40.0))
    assert action is BrainAction.AVOID and changed


def test_threat_from_pip10():
    enc, dec = make_decoder()
    action, changed = dec.update(act(pIP10_L=20.0))
    assert action is BrainAction.THREAT and changed


def test_back_from_mdn():
    enc, dec = make_decoder()
    action, _ = dec.update(act(MDN=30.0))
    assert action is BrainAction.BACK


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


def test_petting_calms_instead_of_approaching():
    enc, dec = make_decoder()
    enc.feed(SensoryEvent(kind=SensoryKind.MOUSE_MOVE, x=-0.5))
    enc.feed(SensoryEvent(kind=SensoryKind.PET_LONG_PRESS))
    action, _ = settle(dec, act(DNg100=20.0))   # touch drive would mean approach
    assert action is BrainAction.INTERACT


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
    action, _ = settle(dec, act(DNg100=5.0))  # below forward threshold, no mouse
    assert action is BrainAction.IDLE


def test_speculative_actions_on_by_default():
    enc, dec = make_decoder()  # speculative defaults to True (named channels,
    action, _ = settle(dec, act(DNg01=25.0))          # exploratory behaviour reading)
    assert action is BrainAction.GROOM
    action, _ = settle(dec, act(DNp10_R=25.0))
    assert action is BrainAction.WING_DISPLAY
    action, _ = settle(dec, act(DNa03_L=18.0))
    assert action is BrainAction.TURN_AWAY


def test_strict_mode_gates_speculative_actions():
    enc, dec = make_decoder(speculative=False)
    action, _ = settle(dec, act(DNg01=25.0, DNp10_L=25.0))
    assert action is not BrainAction.GROOM and action is not BrainAction.WING_DISPLAY


def test_wander_scheduled():
    enc, dec = make_decoder()
    dec.state.wander_until = time.monotonic() + 1.0
    action, _ = settle(dec, act())
    assert action is BrainAction.WANDER


def test_continuous_params():
    enc, dec = make_decoder()
    dec.update(act(DNg100=15.0, DNa02_L=6.0, DNa02_R=1.0))
    p = dec.state.params
    assert abs(p["speed"] - 0.5) < 0.05
    assert abs(p["head_angle"] - 6.0) < 0.1  # (6-1)*1.2 = 6
    assert 0.0 <= p["intensity"] <= 1.0


def test_hysteresis_requires_confirmation():
    enc, dec = make_decoder(confirm=10.0)
    dec.update(act())  # baseline -> REST/IDLE
    action, changed = dec.update(act(DNa02_L=20.0))
    assert action is not BrainAction.MOVE_LEFT and not changed  # candidate only


def test_avoid_interrupts_interact():
    enc, dec = make_decoder(jump_max=0.0)
    enc.feed(SensoryEvent(kind=SensoryKind.PET_CLICK))
    action, _ = settle(dec, act(DNp01_R=40.0))
    assert action is BrainAction.AVOID
