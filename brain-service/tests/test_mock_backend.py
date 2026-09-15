import time

from brain_service.backends.mock import MockBackend

DT_LIMIT = 0.001  # seconds per step; the mock must never be the bottleneck


def test_step_produces_rates():
    b = MockBackend()
    b.reset()
    info = b.step([])
    assert info.sim_t > 0
    activity = b.get_activity()
    assert activity.rates["DNa02_L"] > 0
    assert activity.total > 0


def test_chase_stimulus_steers_left():
    b = MockBackend()
    b.reset()
    for _ in range(30):
        b.step([("chase_L", 0.65)])
    rates = b.get_activity().rates
    assert rates["DNa02_L"] > rates["DNa02_R"] + 3.0


def test_loom_raises_giant_fiber():
    b = MockBackend()
    b.reset()
    base = b.get_activity().rates["DNp01_L"]
    for _ in range(10):
        b.step([("loom_L", 0.85)])
    assert b.get_activity().rates["DNp01_L"] > base + 20.0


def test_save_load_roundtrip():
    b = MockBackend()
    b.reset()
    for _ in range(20):
        b.step([("chase_L", 0.65)])
    b.save_state("/tmp/flypet-mock-state")
    hot = b.get_activity().rates["DNa02_L"]
    b.reset()
    assert b.get_activity().rates["DNa02_L"] < hot
    b.load_state("/tmp/flypet-mock-state")
    # get_activity adds a small live jitter, so compare with tolerance
    assert abs(b.get_activity().rates["DNa02_L"] - hot) < 0.5


def test_step_is_fast():
    b = MockBackend()
    b.reset()
    t0 = time.perf_counter()
    for _ in range(1000):
        b.step([("chase_L", 0.5)])
    assert (time.perf_counter() - t0) / 1000 < DT_LIMIT
