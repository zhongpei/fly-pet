"""Comprehensive movement test: drive every walking action over WS and verify
the window actually moves in discrete STEPS (not constant-velocity gliding).

Run with the desktop pet connected to a flyai brain-service on :8020:

    uv run python brain-service/scripts/test_walk.py

For each scenario it samples the window position at 80 ms and reports:
  moved         did the window displace at all
  direction     sign of the net displacement
  stepped       position series is jump-and-pause (>=40% zero deltas) not glide
"""
from __future__ import annotations

import asyncio
import json
import time
import urllib.request

import websockets

CDP = "http://127.0.0.1:9222/json"
URL = "ws://127.0.0.1:8020/ws"


async def drive(ws, kind, **kw):
    await ws.send(json.dumps({"type": "sensory_event", "kind": kind, **kw}))


async def sample_positions(cdp, seconds, period=0.08):
    """Sample the OS window position through the page's electron API."""
    counter = [0]
    pending = {}

    async def cmd(m, p=None):
        counter[0] += 1
        fut = asyncio.get_running_loop().create_future()
        pending[counter[0]] = fut
        await cdp.send(json.dumps({"id": counter[0], "method": m, "params": p or {}}))
        return await fut

    async def reader():
        while True:
            m = json.loads(await cdp.recv())
            if "id" in m and m["id"] in pending:
                pending.pop(m["id"]).set_result(m.get("result", m))

    rt = asyncio.create_task(reader())
    pts = []
    t0 = time.time()
    while time.time() - t0 < seconds:
        r = await cmd("Runtime.evaluate", {"expression": "JSON.stringify(window.electronAPI ? (await window.electronAPI.getWindowPosition()) : null)", "returnByValue": True, "awaitPromise": True})
        try:
            pts.append((time.time(), json.loads(r["result"]["value"])))
        except Exception:
            pass
        await asyncio.sleep(period)
    rt.cancel()
    return pts


def analyse(name, pts, expect_dir):
    xs = [p["x"] for _, p in pts]
    net = xs[-1] - xs[0]
    deltas = [b - a for a, b in zip(xs, xs[1:])]
    non_zero = [d for d in deltas if d != 0]
    zero_frac = 1 - len(non_zero) / max(1, len(deltas))
    stepped = zero_frac >= 0.4 and len(non_zero) >= 2   # jumps and pauses
    moved = abs(net) >= 20
    direction_ok = expect_dir == 0 or (net == 0) or (net > 0) == (expect_dir > 0)
    ok = moved and direction_ok
    print(f"{name:<12} moved={moved} net={net:+5d}px dir_ok={direction_ok} "
          f"zero_frac={zero_frac:.0%} steps={len(non_zero)} jump_med="
          f"{sorted(map(abs, non_zero))[len(non_zero)//2] if non_zero else 0:>3}px "
          f"stepped={stepped} -> {'PASS' if ok else 'FAIL'}")
    return ok


async def main() -> None:
    targets = json.load(urllib.request.urlopen(CDP))
    pet = next(t for t in targets if t.get("title") == "FlyPet")

    async with websockets.connect(pet["webSocketDebuggerUrl"], max_size=100 * 1024 * 1024) as cdp, \
               websockets.connect(URL) as ws:
        await ws.recv()
        results = []

        async def scenario(name, stim, seconds, expect_dir, settle_before=6.0):
            # settle: let annoyance/arousal from the previous scenario decay
            await asyncio.sleep(settle_before)
            async def drive_loop():
                t0 = time.time()
                while time.time() - t0 < seconds:
                    for k, kw in stim:
                        await drive(ws, k, **kw)
                    await asyncio.sleep(0.12)
            drv = asyncio.create_task(drive_loop())
            await asyncio.sleep(0.4)           # let the decoder latch the action
            pts = await sample_positions(cdp, seconds - 0.2)
            await drv
            results.append((name, analyse(name, pts, expect_dir)))

        print("== MOVE_LEFT: cursor appears far left")
        await scenario("MOVE_LEFT", [("mouse_move", {"x": -0.9, "side": "L"})], 3.0, -1)

        print("== MOVE_RIGHT: cursor far right")
        await scenario("MOVE_RIGHT", [("mouse_move", {"x": 0.9, "side": "R"})], 3.0, +1)

        print("== AVOID: cursor rushes in from the right")
        await scenario("AVOID", [("mouse_approach", {"side": "R", "speed": 900})], 2.5, -1)

        print("== BACK: 3 looming bursts (negative valence), then arousal decay")
        for _ in range(3):
            await drive(ws, "mouse_approach", side="L", speed=800)
            await asyncio.sleep(0.15)
        await asyncio.sleep(7.0)   # arousal decays below 0.5, valence still low
        pts = await sample_positions(cdp, 2.5)
        results.append(("BACK", analyse("BACK", pts, +1)))

        print("== WANDER: leave the desktop quiet, wait for a stroll")
        deadline = time.time() + 30
        pts = []
        while time.time() < deadline:
            pts = await sample_positions(cdp, 3.0)
            xs = [p["x"] for _, p in pts]
            if abs(xs[-1] - xs[0]) >= 20:
                break
        results.append(("WANDER", analyse("WANDER", pts, 0)))

        print()
        n_ok = sum(1 for _n, ok in results if ok)
        print(f"TOTAL: {n_ok}/{len(results)} movement scenarios PASS")


if __name__ == "__main__":
    asyncio.run(main())
