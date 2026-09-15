"""Synthetic desktop-scenario demo: drive brain-service over WS like a user would.

    uv run flypet-serve --backend mock --port 8020   # terminal 1
    uv run python brain-service/scripts/demo.py      # terminal 2
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
            """Print brain_state transitions while the scenario segment runs."""
            t0 = asyncio.get_event_loop().time()
            last = None
            while asyncio.get_event_loop().time() - t0 < seconds:
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.2))
                except asyncio.TimeoutError:
                    continue
                if msg["type"] == "brain_state" and msg["action"] != last:
                    last = msg["action"]
                    print(f"  {label:<22} -> {msg['action']} ({msg['avatar']})")

        print("[1] cursor appears on the left, lingers")
        for _ in range(6):
            await ev(ws, "mouse_move", x=-0.9, side="L")
            await asyncio.sleep(0.25)
        await watch(2.5, "mouse-left")

        print("[2] cursor rushes at the pet")
        await ev(ws, "mouse_approach", side="L", speed=900)
        await watch(2.0, "looming")

        print("[3] user pokes the pet")
        await ev(ws, "pet_click")
        await watch(2.5, "click")

        print("[4] an object appears, then is removed")
        await ev(ws, "object_appear")
        await watch(2.0, "object")
        await ev(ws, "object_remove")
        await watch(1.5, "object-gone")

        print("[5] desktop goes quiet (REST needs a while)")
        await watch(2.0, "quiet")
        print("demo done")


if __name__ == "__main__":
    asyncio.run(main())
