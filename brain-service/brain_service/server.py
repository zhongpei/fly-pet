"""WebSocket server around a brain runner thread.

    uv run flypet-serve --backend flyai        # the real connectome
    uv run flypet-serve --backend mock         # no data needed

Endpoints:
    ws://host:port/ws       protocol from brain_service.protocol
    http://host:port/lab/   Brain Lab (served from brain_service/brain_lab)
    http://host:port/healthz
"""
from __future__ import annotations

import argparse
import asyncio
import json
import threading
import time
from pathlib import Path

from aiohttp import WSMsgType, web

from .backend import BrainBackend
from .backends.mock import MockBackend
from .decoder.dn_decoder import ActionDecoder, DecoderConfig
from .emotion import EmotionConfig, EmotionEngine
from .protocol import AVATAR_ACTION_MAP, SensoryEvent
from .sensory.encoder import SensoryEncoder
from .telemetry import Sample, Telemetry

DT = 0.020


class BrainRunner(threading.Thread):
    """Owns the backend and steps it in a tight loop off the asyncio thread."""

    def __init__(self, backend_name: str, pace: bool = True, speculative: bool = False) -> None:
        super().__init__(daemon=True, name="brain-runner")
        self.backend_name = backend_name
        self.pace = pace
        self.speculative = speculative
        self.encoder = SensoryEncoder()
        self.decoder = ActionDecoder(self.encoder, DecoderConfig(speculative=speculative))
        self.emotion = EmotionEngine(EmotionConfig(speculative=speculative))
        self.backend: BrainBackend = MockBackend() if backend_name == "mock" else None
        self.telemetry = Telemetry()
        self._lock = threading.Lock()
        self._snap: dict = {
            "action": "IDLE", "rates": {}, "fired": 0, "sim_t": 0.0,
            "steps_per_s": 0.0, "load": 0.0, "ready": backend_name == "mock",
            "error": None, "backend": backend_name, "stim": {},
            "emotion": {"arousal": 0.0, "valence": 0.0, "expression": "neutral"},
            "params": {"speed": 0.0, "head_angle": 0.0, "intensity": 0.0},
        }
        self._stop = threading.Event()

    def run(self) -> None:
        if self.backend is None:
            self._build_real_backend()
        backend = self.backend
        if backend is None:  # build failed: degrade to mock so the pet still moves
            backend = self.backend = MockBackend()
        else:
            with self._lock:
                self._snap.update(ready=True, backend=backend.name)
        backend.reset()

        window, steps_in_window, window_t0 = 2.0, 0, time.monotonic()
        while not self._stop.is_set():
            if self.backend_name != "mock" and not getattr(backend, "ready", True):
                time.sleep(0.1)
                continue
            with self._lock:
                stimuli = self.encoder.stimuli()
            emotion = self.emotion.update(
                total_rate=self._snap.get("total", 0.0) or sum(self._snap["rates"].values()),
                sensory_energy=self.encoder.sensory_energy(),
                resting=False,
            )
            all_stimuli = stimuli + list(emotion.drives.items())
            info = backend.step(all_stimuli)
            activity = backend.get_activity()
            action, _changed = self.decoder.update(activity)
            stim = {ch: round(s, 2) for ch, s in all_stimuli}

            steps_in_window += 1
            t = time.monotonic()
            if t - window_t0 >= window:
                sps, steps_in_window, window_t0 = steps_in_window / (t - window_t0), 0, t
            else:
                sps = self._snap.get("steps_per_s", 0.0)

            self.telemetry.push(Sample(
                wall_t=t, sim_t=info.sim_t, action=action.value,
                rates=dict(activity.rates), fired=info.fired, steps_per_s=sps,
            ))
            with self._lock:
                self._snap.update(
                    action=action.value, rates=dict(activity.rates), fired=info.fired,
                    sim_t=info.sim_t, steps_per_s=sps,
                    load=min(1.0, info.wall_dt / DT), total=activity.total, stim=stim,
                    params=dict(self.decoder.state.params),
                    emotion={"arousal": round(emotion.arousal, 3),
                             "valence": round(emotion.valence, 3),
                             "expression": emotion.expression.value,
                             "annoyance": emotion.annoyance},
                )
            if self.pace and info.wall_dt < DT:
                time.sleep(DT - info.wall_dt)

    def _build_real_backend(self) -> None:
        from .backends.flyai import FlyAIBackend

        backend = FlyAIBackend()
        try:
            backend.build()
            self.backend = backend
        except Exception as exc:  # noqa: BLE001 - keep serving, tell the clients
            with self._lock:
                self._snap.update(backend="mock", error=f"flyai backend failed: {exc}")

    def feed_event(self, ev: SensoryEvent) -> None:
        with self._lock:
            self.encoder.feed(ev)
            self._emotion_event(ev)

    def _emotion_event(self, ev: SensoryEvent) -> None:
        """Route affect-relevant events into the emotion engine."""
        from .protocol import SensoryKind as K

        emo = self.emotion
        if ev.kind is K.PET_CLICK or ev.kind is K.PET_DOUBLE_CLICK:
            emo.on_click()
        elif ev.kind is K.PET_LONG_PRESS:
            emo.on_petting(True)
        elif ev.kind is K.PET_LONG_RELEASE:
            emo.on_petting(False)
            emo.add_valence(0.25)  # a finished petting session feels good
        elif ev.kind is K.MOUSE_APPROACH:
            emo.add_valence(-0.18)
        elif ev.kind is K.OBJECT_APPEAR:
            emo.add_valence({"food": 0.25, "rival": -0.35, "toy": 0.1}.get(ev.cls, 0.05))

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self._snap)

    def stop(self) -> None:
        self._stop.set()


def make_app(runner: BrainRunner) -> web.Application:
    clients: set[web.WebSocketResponse] = set()

    async def ws_handler(request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        clients.add(ws)
        print(f"[flypet] ws open ({len(clients)} clients)", flush=True)
        try:
            snap = runner.snapshot()
            await ws.send_json({"type": "welcome", "backend": snap["backend"],
                                "ready": snap["ready"], "error": snap["error"],
                                "avatar_map": AVATAR_ACTION_MAP})
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                    except json.JSONDecodeError:
                        continue
                    mtype = data.get("type")
                    if mtype == "sensory_event":
                        kind = data.get("kind")
                        if isinstance(kind, str) and kind.startswith("pet_"):
                            print(f"[flypet] sensory {kind} ts={data.get('ts')}", flush=True)
                        try:
                            runner.feed_event(SensoryEvent.from_message(data))
                        except (KeyError, ValueError):
                            await ws.send_json({"type": "error", "detail": "bad sensory_event"})
                    elif mtype == "ping":
                        await ws.send_json({"type": "pong"})
                elif msg.type == WSMsgType.ERROR:
                    print(f"[flypet] ws error: {ws.exception()}", flush=True)
        finally:
            clients.discard(ws)
            print(f"[flypet] ws close: type={msg.type if msg else 'none'} "
                  f"code={ws.close_code} exc={ws.exception()} ({len(clients)} clients)", flush=True)
        return ws

    async def broadcaster(app: web.Application) -> None:
        last_action = None
        last_expression = None
        while True:
            snap = runner.snapshot()
            payload_rates = {k: round(v, 1) for k, v in snap.get("rates", {}).items()}
            emotion = snap.get("emotion", {})
            params = snap.get("params", {})
            action = snap["action"]
            if clients:
                if action != last_action:
                    state = {"type": "brain_state", "action": action,
                             "avatar": AVATAR_ACTION_MAP.get(action, "idle"),
                             "expression": emotion.get("expression", "neutral"),
                             "intensity": params.get("intensity", 0.0),
                             "params": {"speed": params.get("speed", 0.0),
                                        "head_angle": params.get("head_angle", 0.0)},
                             "ts": time.time()}
                    await asyncio.gather(*(c.send_json(state) for c in list(clients)),
                                         return_exceptions=True)
                    last_action = action
                elif emotion.get("expression") != last_expression:
                    # expression may drift while the action holds
                    await asyncio.gather(*(c.send_json(
                        {"type": "brain_emotion", **emotion, "ts": time.time()}
                    ) for c in list(clients)), return_exceptions=True)
                last_expression = emotion.get("expression")
                telemetry = {"type": "brain_telemetry", "action": action,
                             "rates": payload_rates, "fired": snap["fired"],
                             "stim": snap.get("stim", {}),
                             "emotion": emotion,
                             "params": params,
                             "sim_t": round(snap["sim_t"], 3),
                             "steps_per_s": round(snap["steps_per_s"], 1),
                             "load": round(snap["load"], 3),
                             "ready": snap["ready"], "error": snap["error"],
                             "ts": time.time()}
                await asyncio.gather(*(c.send_json(telemetry) for c in list(clients)),
                                     return_exceptions=True)
            await asyncio.sleep(0.1)

    async def healthz(request: web.Request) -> web.Response:
        snap = runner.snapshot()
        return web.json_response({"status": "ok" if snap["ready"] else "loading",
                                  "clients": len(clients),
                                  **{k: snap[k] for k in ("backend", "ready", "error")}})

    async def lab_positions(request: web.Request) -> web.Response:
        backend = runner.backend
        positions = backend.positions() if hasattr(backend, "positions") else None
        if positions is None:
            raise web.HTTPNotFound(reason="no neuron positions in this backend")
        return web.Response(body=positions.tobytes(), content_type="application/octet-stream")

    async def lab_populations(request: web.Request) -> web.Response:
        backend = runner.backend
        if not hasattr(backend, "population_indices"):
            raise web.HTTPNotFound(reason="populations only exist on the flyai backend")
        return web.json_response(backend.population_indices())

    async def index(request: web.Request) -> web.Response:
        raise web.HTTPFound("/lab/")

    async def on_startup(app: web.Application) -> None:
        app["broadcaster"] = asyncio.create_task(broadcaster(app))

    async def on_cleanup(app: web.Application) -> None:
        app["broadcaster"].cancel()

    async def lab_index(request: web.Request) -> web.Response:
        return web.FileResponse(lab_dir / "index.html")

    app = web.Application()
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/healthz", healthz)
    app.router.add_get("/", index)
    lab_dir = Path(__file__).parent / "brain_lab"
    if (lab_dir / "index.html").exists():
        app.router.add_get("/lab", lab_index)
        app.router.add_get("/lab/", lab_index)
        app.router.add_get("/lab/positions", lab_positions)
        app.router.add_get("/lab/populations", lab_populations)
        app.router.add_static("/lab/", lab_dir, show_index=False)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="flypet brain-service")
    parser.add_argument("--backend", choices=["mock", "flyai"], default="flyai")
    parser.add_argument("--port", type=int, default=8020)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--free-run", action="store_true",
                        help="step as fast as possible instead of pacing to 50 Hz")
    parser.add_argument("--speculative", action="store_true",
                        help="enable speculative drives/actions (GROOM, WING_DISPLAY, TURN_AWAY)")
    args = parser.parse_args()

    runner = BrainRunner(args.backend, pace=not args.free_run, speculative=args.speculative)
    runner.start()
    print(f"[flypet] brain-service on ws://{args.host}:{args.port}/ws (backend={args.backend})")
    web.run_app(make_app(runner), host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
