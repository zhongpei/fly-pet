from brain_service.emotion import EmotionConfig, EmotionEngine


def clicks(engine, n):
    for _ in range(n):
        engine.on_click()


def test_clicks_accumulate_annoyance_and_decay():
    e = EmotionEngine()
    clicks(e, 3)
    assert e.state.annoyance == 3
    e._click_times = [t - 60 for t in e._click_times]  # age them out
    e.update(total_rate=50, sensory_energy=0.0, resting=False)
    assert e.state.annoyance == 0


def test_annoyance_drives_threat():
    e = EmotionEngine()
    clicks(e, 4)  # annoy_clicks(3) + 1
    e.state.valence = -0.2
    st = e.update(total_rate=80, sensory_energy=0.2, resting=False)
    assert st.drives.get("threat_L", 0) > 0
    assert st.expression.value == "annoyed"


def test_petting_builds_positive_valence_and_contentment():
    e = EmotionEngine()
    e.on_petting(True)
    for _ in range(200):
        e.update(total_rate=10, sensory_energy=0.3, resting=False)
    e.state.arousal = 0.2  # petted calm: low arousal after the burst
    st = e.update(total_rate=10, sensory_energy=0.0, resting=False)
    assert st.valence > 0.3
    assert st.expression is not None


def test_negative_valence_drives_retreat():
    e = EmotionEngine()
    e.add_valence(-0.6)
    e.state.arousal = 0.3
    st = e.update(total_rate=40, sensory_energy=0.0, resting=False)
    assert st.drives.get("retreat_L", 0) > 0


def test_valence_decays_toward_zero():
    e = EmotionEngine()
    e.add_valence(0.8)
    for _ in range(500):
        e.update(total_rate=0, sensory_energy=0.0, resting=False)
    assert abs(e.state.valence) < 0.8


def test_speculative_gate_holds_back_groom_display():
    e = EmotionEngine(EmotionConfig(speculative=False))
    e.add_valence(0.9)
    e._next_display = 0.0  # due now
    st = e.update(total_rate=0, sensory_energy=0.0, resting=False)
    assert "display_L" not in st.drives

    e2 = EmotionEngine(EmotionConfig(speculative=True))
    e2.add_valence(0.9)
    e2._next_display = 0.0
    st2 = e2.update(total_rate=0, sensory_energy=0.0, resting=False)
    assert st2.drives.get("display_L", 0) > 0


def test_head_pat_soothes_and_forgives_a_poke():
    eng = EmotionEngine(EmotionConfig(), seed=1)
    eng.on_click()
    eng.on_click()
    assert eng.state.annoyance == 2
    v_before = eng.state.valence
    eng.on_head_pat()
    assert eng.state.annoyance == 1            # a pat calms one poke
    assert eng.state.valence > v_before        # and feels nice


def test_being_held_triggers_struggle_drives():
    eng = EmotionEngine(EmotionConfig(), seed=1)
    v_before = eng.state.valence
    eng.on_held()
    st = eng.update(0.0, 0.0, resting=False)
    assert eng.state.valence < v_before
    assert st.drives.get("retreat_L", 0) > 0   # MDN backward: struggling
    assert st.drives.get("threat_L", 0) > 0    # wing flick
