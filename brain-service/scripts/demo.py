"""Synthetic desktop-scenario demo: drive brain-service over WS like a user would.

    uv run flypet-serve --backend mock --port 8020   # terminal 1
    uv run python brain-service/scripts/demo.py      # terminal 2
    (or --backend flyai for the real connectome)
"""
from __future__ import annotations

import asyncio
import json
import sys

import websockets

URL = sys.argv[1] if len(sys.argv) > 1 else "ws://127.0.0.1:8020/ws"


async def ev(ws, kind, **kw):
    await ws.send(json.dumps({"type": "sensory_event", "kind": kind, **kw}))


async def main() -> None:
    async with websockets.connect(URL) as ws:
        welcome = json.loads(await ws.recv())
        print(f"connected to {welcome['backend']} (ready={welcome['ready']})")

        async def watch(seconds: float, label: str) -> None:
            """Print brain_state / emotion transitions while the segment runs."""
            t0 = asyncio.get_event_loop().time()
            last = None
            while asyncio.get_event_loop().time() - t0 < seconds:
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.2))
                except asyncio.TimeoutError:
                    continue
                if msg["type"] == "brain_state" and msg["action"] != last:
                    last = msg["action"]
                    tail = f" [{msg.get('expression')}]" if msg.get("expression") else ""
                    print(f"  {label:<20} -> {msg['action']} ({msg['avatar']}){tail}")

        print("[1] cursor appears on the left, lingers")
        for _ in range(6):
            await ev(ws, "mouse_move", x=-0.9, side="L")
            await asyncio.sleep(0.25)
        await watch(2.5, "mouse-left")

        print("[2] double click -> startle (JUMP)")
        await ev(ws, "pet_click")
        await ev(ws, "pet_double_click")
        await watch(1.5, "startle")

        print("[3] user pokes the pet repeatedly -> annoyance -> THREAT")
        for _ in range(4):
            await ev(ws, "pet_click")
            await asyncio.sleep(0.4)
        await watch(2.5, "poked")

        print("[4] petting (long press) -> content")
        await ev(ws, "pet_long_press")
        await watch(2.0, "petting")
        await ev(ws, "pet_long_release")
        await watch(1.0, "released")

        print("[5] a rival shows up -> odour threat")
        await ev(ws, "object_appear", cls="rival")
        await watch(2.0, "rival")
        await ev(ws, "object_remove")
        await watch(1.5, "rival-gone")

        print("[6] desktop goes quiet (REST needs a while)")
        await watch(2.0, "quiet")
        print("demo done")


if __name__ == "__main__":
    asyncio.run(main())
