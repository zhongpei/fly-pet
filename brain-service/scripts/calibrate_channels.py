"""V1 calibration: dose-response curves for candidate command neurons.

For every named descending neuron we plan to build actions on, inject
directly (the optogenetics-style "internal drive" route) at several
strengths and measure the spike rate. The output JSON decides the encoder
strengths and decoder thresholds for V1 — same methodology as V0
(verify_flybrain.py), no guessed thresholds.

    uv run python brain-service/scripts/calibrate_channels.py [--side L]
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

import numpy as np

CHANNELS = ["DNp01", "DNa02", "DNa03", "DNp10", "pIP10", "MDN", "DNg01", "DNg09", "DNg11", "DNg13"]
STRENGTHS = [0.2, 0.4, 0.6, 0.8, 1.0]
INJECT_S, MEASURE_S = 0.8, 1.2


def measure(brain, idx, strength, eye):
    """Mean rate of `idx` during the measurement window of one injection."""
    steps_in, steps_meas = int(INJECT_S / brain.dt), int(MEASURE_S / brain.dt)
    hits = 0
    for s in range(steps_in + steps_meas):
        if strength > 0:
            brain.stimulate(idx, strength)
        fired = brain.step(eye)
        if s >= steps_in:
            hits += int(np.intersect1d(fired, idx, assume_unique=False).size)
    return hits / len(idx) / (MEASURE_S)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--side", default="L", choices=["L", "R"])
    args = parser.parse_args()

    from flybrain import FlyBrain

    t0 = time.perf_counter()
    brain = FlyBrain(device="cpu")
    print(f"brain loaded ({time.perf_counter() - t0:.0f}s), n={brain.n}")
    eye = np.full(len(brain.visual), 0.45, np.float32)
    ct, side = brain.cell_type, brain.side

    result: dict[str, dict] = {}
    for name in CHANNELS:
        idx = np.flatnonzero((ct == name) & (side == args.side))
        if not len(idx):
            result[name] = {"pop": 0, "note": "absent"}
            continue
        curve = {}
        for s in STRENGTHS:
            brain.reset()
            curve[str(s)] = round(measure(brain, idx, s, eye), 1)
        brain.reset()
        base = round(measure(brain, idx, 0.0, eye), 1)
        # lowest strength that sustains >= 10 Hz (single neurons cap at 50)
        firing_from = next((s for s in STRENGTHS if curve[str(s)] >= 10.0), None)
        result[name] = {"pop": int(len(idx)), "baseline": base, "curve": curve,
                        "fires_from": firing_from}
        print(f"{name:7s} pop={len(idx):2d} base={base:5.1f} "
              + " ".join(f"{s}:{curve[str(s)]:5.1f}" for s in STRENGTHS)
              + f"  fires_from={firing_from}")

    out = Path(__file__).parent / "calibrate_result.json"
    out.write_text(json.dumps({"side": args.side, "strengths": STRENGTHS,
                               "channels": result}, indent=2))
    print(f"written to {out}")


if __name__ == "__main__":
    main()
