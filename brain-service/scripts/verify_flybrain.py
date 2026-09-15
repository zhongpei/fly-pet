"""Phase 0 gate: does the real connectome respond correctly on this machine?

Reproduces fly.ai's validated inject.py result on this exact hardware:
    LC4+LPLC2 (left) -> DNp01 (left) should rise by ~+15-25 Hz
    LC10a    (left) -> DNa02 (left) should rise by ~+1.5-4 Hz
and measures the per-step wall time that decides our real-time pacing.

    uv run python brain-service/scripts/verify_flybrain.py [--seconds 2.0]
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

import numpy as np

TRACKED = ["DNp01", "DNa02", "DNg100", "MDN"]


def rates_for(brain, hit, readout):
    out = {}
    for name, types in (("DNp01", ["DNp01"]), ("DNa02", ["DNa02"]), ("DNg100", ["DNg100"]), ("MDN", ["MDN"])):
        for side in "LR":
            idx = np.flatnonzero((brain.cell_type == types[0]) & (brain.side == side)) if side else []
            key = f"{name}_{side}"
            if len(idx):
                out[key] = float(hit[idx].sum()) / len(idx) / brain.dt
    idx = np.flatnonzero(brain.cell_type == "DNg100")
    out["DNg100"] = float(hit[idx].sum()) / len(idx) / brain.dt
    idx = np.flatnonzero(brain.cell_type == "MDN")
    out["MDN"] = float(hit[idx].sum()) / len(idx) / brain.dt
    return {k: v for k, v in out.items() if k in [f"{t}_{s}" for t in TRACKED for s in "LR"] + ["DNg100", "MDN"]}


def run_phase(brain, target, strength, seconds, eye, readout):
    """Returns mean rates over the measurement window (0.5 s warmup discarded)."""
    steps, warm = int(seconds / brain.dt), int(0.5 / brain.dt)
    hit = np.zeros(brain.n, bool)
    acc = {k: 0.0 for k in readout}
    for s in range(steps):
        if target is not None:
            brain.stimulate(target, strength)
        fired = brain.step(eye)
        hit[:] = False
        hit[fired] = True
        if s >= warm:
            for k, v in rates_for(brain, hit, readout).items():
                acc[k] += v
    n = steps - warm
    return {k: v / n for k, v in acc.items()}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=2.0)
    args = parser.parse_args()

    from flybrain import FlyBrain

    t0 = time.perf_counter()
    brain = FlyBrain(device="cpu")
    print(f"brain loaded: n={brain.n} dt={brain.dt} load={time.perf_counter() - t0:.1f}s")
    print(f"positions available: {brain.positions is None and 'NO' or 'yes'}")
    if brain.superclass is None:
        print("superclass: MISSING (touch fallback will be coarse)")
    eye = np.full(len(brain.visual), 0.45, np.float32)

    ct, side = brain.cell_type, brain.side
    loom = np.flatnonzero(np.isin(ct, ["LC4", "LPLC2"]) & (side == "L"))
    chase = np.flatnonzero((ct == "LC10a") & (side == "L"))
    readout = [f"{t}_{s}" for t in TRACKED for s in "LR"] + ["DNg100", "MDN"]

    t0 = time.perf_counter()
    for _ in range(30):  # numba compile + warmup
        brain.step(eye)
    print(f"first-30-steps (incl. compile): {time.perf_counter() - t0:.1f}s")

    brain.reset()
    base = run_phase(brain, None, 0.0, args.seconds, eye, readout)
    print(f"baseline: " + " ".join(f"{k}={v:.1f}" for k, v in base.items()))

    brain.reset()
    loom_rates = run_phase(brain, loom, 0.8, args.seconds, eye, readout)
    brain.reset()
    chase_rates = run_phase(brain, chase, 0.8, args.seconds, eye, readout)

    def delta(stim):
        ref = loom_rates if stim is loom_rates else chase_rates
        return {k: round(ref[k] - base.get(k, 0.0), 1) for k in ref}

    print(f"loom  LC4+LPLC2 L x0.8 : " + " ".join(f"{k}{v:+.1f}" for k, v in delta(loom_rates).items()))
    print(f"chase LC10a    L x0.8 : " + " ".join(f"{k}{v:+.1f}" for k, v in delta(chase_rates).items()))

    brain.reset()
    lat = []
    for _ in range(150):
        brain.stimulate(loom, 0.8)
        t0 = time.perf_counter()
        brain.step(eye)
        lat.append((time.perf_counter() - t0) * 1000)
    lat.sort()
    summary = {
        "n": int(brain.n),
        "dt": brain.dt,
        "positions": brain.positions is not None,
        "superclass": brain.superclass is not None,
        "baseline": {k: round(v, 1) for k, v in base.items()},
        "loom_delta": delta(loom_rates),
        "chase_delta": delta(chase_rates),
        "step_ms": {"median": round(statistics.median(lat), 1),
                    "mean": round(statistics.mean(lat), 1),
                    "p95": round(lat[int(len(lat) * 0.95)], 1),
                    "max": round(max(lat), 1)},
        "max_steps_per_s": round(1000.0 / statistics.median(lat), 1),
        "loom_pop": int(len(loom)), "chase_pop": int(len(chase)),
    }
    out = Path(__file__).parent / "verify_result.json"
    out.write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"written to {out}")


if __name__ == "__main__":
    main()
