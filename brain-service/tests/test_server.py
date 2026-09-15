"""End-to-end test of the WS surface with the mock backend (server not pacing)."""
import asyncio
import json
import unittest

from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer

from brain_service.server import BrainRunner, make_app


class ServerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.runner = BrainRunner("mock", pace=False)
        # step a few times manually so rates exist; the thread is not started
        for _ in range(5):
            self.runner.backend.step([])
        self.client = TestClient(TestServer(make_app(self.runner)))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()

    async def test_healthz_and_ws_protocol(self):
        health = await self.client.get("/healthz")
        self.assertEqual(health.status, 200)
        body = await health.json()
        self.assertEqual(body["backend"], "mock")

        ws = await self.client.ws_connect("/ws")
        welcome = json.loads((await ws.receive()).data)
        self.assertEqual(welcome["type"], "welcome")
        self.assertIn("IDLE", welcome["avatar_map"])

        await ws.send_json({"type": "sensory_event", "kind": "mouse_move", "x": -0.8})
        await ws.send_json({"type": "ping"})

        got_state = got_telemetry = got_pong = False
        for _ in range(10):
            msg = await asyncio.wait_for(ws.receive(), timeout=2)
            if msg.type is not WSMsgType.TEXT:
                continue
            data = json.loads(msg.data)
            if data["type"] == "brain_state":
                got_state = True
                self.assertIn("action", data)
            elif data["type"] == "brain_telemetry":
                got_telemetry = True
                self.assertIn("rates", data)
            elif data["type"] == "pong":
                got_pong = True
            if got_state and got_telemetry and got_pong:
                break
        self.assertTrue(got_state and got_telemetry and got_pong)
        await ws.close()


if __name__ == "__main__":
    unittest.main()
