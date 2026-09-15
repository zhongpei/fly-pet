"""FlyAIBackend: the real MaleCNS connectome (166,700 neurons) via flybrain.

Stimulation recipe follows fly.ai's validated inject.py: tonic 0.14, gain 3.0,
a faint constant eye drive (0.45 on every photoreceptor), and direct injection
into feature-detector populations on one side at a time.
"""
from __future__ import annotations

import threading

import numpy as np

from ..backend import BrainActivity, BrainBackend, StepInfo, empty_activity
from ..protocol import DN_CHANNELS

# channel -> (cell types, side); side "C" means both sides pooled
CHANNEL_TYPES: dict[str, tuple[list[str], str]] = {
    "chase_L": (["LC10a"], "L"),
    "chase_R": (["LC10a"], "R"),
    "loom_L": (["LC4", "LPLC2"], "L"),
    "loom_R": (["LC4", "LPLC2"], "R"),
    "touch_L": (["mechano"], "L"),
    "touch_R": (["mechano"], "R"),
    "odor": (["ORN"], "C"),
}

# tracked descending populations: DN channel -> (types, side)
DN_TYPES: dict[str, tuple[list[str], str]] = {
    "DNp01_L": (["DNp01"], "L"),
    "DNp01_R": (["DNp01"], "R"),
    "DNa02_L": (["DNa02"], "L"),
    "DNa02_R": (["DNa02"], "R"),
    "DNg100": (["DNg100"], None),
    "MDN": (["MDN"], None),
}


class FlyAIBackend(BrainBackend):
    name = "flyai"

    def __init__(
        self,
        device: str = "cpu",
        seed: int = 64,
        sensory_input: bool = False,
        eye_drive: float = 0.45,
        max_population: int = 250,
    ) -> None:
        # Heavy work (data load + numba compile) happens in _build(), called
        # from the brain thread so the server can answer meanwhile.
        self._device = device
        self._seed = seed
        self._sensory_input = sensory_input
        self._eye_drive = eye_drive
        self._max_pop = max_population
        self._brain = None
        self._chan_idx: dict[str, np.ndarray] = {}
        self._dn_idx: dict[str, np.ndarray] = {}
        self._rate_ema: dict[str, float] = {k: 0.0 for k in DN_CHANNELS}
        self._built = threading.Event()
        self._build_error: str | None = None

    # ---- construction ----------------------------------------------------

    def build(self) -> None:
        """Load the connectome and resolve every population. Raises on failure."""
        from flybrain import FlyBrain

        brain = FlyBrain(device=self._device, seed=self._seed, sensory_input=self._sensory_input)
        ct, side = brain.cell_type, brain.side

        def resolve(types: list[str], side_sel: str | None) -> np.ndarray:
            mask = np.isin(ct, types)
            if side_sel:
                mask &= side == side_sel
            idx = np.flatnonzero(mask)[: self._max_pop]
            return idx

        for chan, (types, side_sel) in CHANNEL_TYPES.items():
            if types == ["mechano"]:  # no single "touch" type; fall back below
                idx = self._touch_population(brain, side_sel)
            elif types == ["ORN"]:
                idx = self._orn_population(brain)
            else:
                idx = resolve(types, side_sel)
            self._chan_idx[chan] = idx
        for dn, (types, side_sel) in DN_TYPES.items():
            self._dn_idx[dn] = resolve(types, side_sel)

        missing = [k for k, v in self._chan_idx.items() if len(v) == 0]
        if missing:
            raise RuntimeError(f"no neurons found for channels {missing}; check brain data")
        self._brain = brain
        self._eye = np.full(len(brain.visual), self._eye_drive, np.float32)
        self._built.set()

    def _touch_population(self, brain, side_sel: str) -> np.ndarray:
        """MaleCNS has no cell type literally named touch; use mechanosensory
        populations (cell type mentioning mechano/bristle/jo), else sensory
        superclass neurons that are neither olfactory nor visual."""
        ct, sc, side = brain.cell_type, brain.superclass, brain.side
        names = np.char.lower(np.asarray(ct, dtype=str))
        mech = (
            (np.char.find(names, "mechano") >= 0)
            | (np.char.find(names, "bristle") >= 0)
            | (np.char.find(names, "johnston") >= 0)
            | (np.char.find(names, "jn_") >= 0)
        )
        mask = mech & (side == side_sel)
        idx = np.flatnonzero(mask)
        if len(idx):
            return idx[: self._max_pop]
        sens = (sc is not None) & (np.char.find(np.asarray(sc, dtype=str), "sensory") >= 0)
        not_chemo = ~np.char.startswith(names, "orn")
        not_visual = (np.char.find(names, "lc") < 0) & (np.char.find(names, "lplc") < 0)
        mask = sens & not_chemo & not_visual & (side == side_sel)
        return np.flatnonzero(mask)[: self._max_pop]

    def _orn_population(self, brain) -> np.ndarray:
        names = np.asarray(brain.cell_type, dtype=str)
        return np.flatnonzero(np.char.startswith(names, "ORN"))[: self._max_pop]

    @property
    def ready(self) -> bool:
        return self._built.is_set()

    @property
    def build_error(self) -> str | None:
        return self._build_error

    def positions(self) -> np.ndarray | None:
        """(n, 3) neuron coordinates for the 3D viewer, if the data has them."""
        if self._brain is not None and getattr(self._brain, "positions", None) is not None:
            return np.asarray(self._brain.positions, dtype=np.float32)
        return None

    def population_indices(self) -> dict[str, dict[str, list[int]]]:
        """Tracked neuron indices per channel, for highlighting in the viewer."""
        return {
            "channels": {k: v.tolist() for k, v in self._chan_idx.items()},
            "dn": {k: v.tolist() for k, v in self._dn_idx.items()},
        }

    # ---- BrainBackend ----------------------------------------------------

    def reset(self) -> None:
        if self._brain:
            self._brain.reset()
        self._rate_ema = {k: 0.0 for k in DN_CHANNELS}

    def step(self, stimuli: list[tuple[str, float]]) -> StepInfo:
        import time as _time

        t0 = _time.perf_counter()
        brain = self._brain
        inject = []
        for channel, strength in stimuli:
            idx = self._chan_idx.get(channel)
            if idx is not None and len(idx) and strength > 0:
                inject.append((idx, strength))
        fired = brain.step(self._eye, inject=inject)

        hit = np.zeros(brain.n, bool)
        hit[fired] = True
        a = 1.0 / brain.dt
        for dn, idx in self._dn_idx.items():
            rate = float(hit[idx].sum()) / max(1, len(idx)) * a if len(idx) else 0.0
            prev = self._rate_ema[dn]
            self._rate_ema[dn] = prev + 0.35 * (rate - prev)
        self._sim_t = brain.steps * brain.dt
        return StepInfo(sim_t=self._sim_t, wall_dt=_time.perf_counter() - t0, fired=int(len(fired)))

    def get_activity(self) -> BrainActivity:
        act = empty_activity()
        act.rates = dict(self._rate_ema)
        act.total = sum(act.rates.values())
        return act

    def save_state(self, path: str) -> None:
        np.savez(path, v=self._brain.v, steps=self._brain.steps)

    def load_state(self, path: str) -> None:
        data = np.load(path)
        self._brain.v[:] = data["v"]
        self._brain.steps = int(data["steps"])

    def info(self) -> dict:
        base = super().info()
        base.update(
            device=self._device,
            n=getattr(self._brain, "n", None),
            dt=getattr(self._brain, "dt", None),
            ready=self.ready,
            error=self.build_error,
            populations={k: int(len(v)) for k, v in self._chan_idx.items()},
        )
        return base
