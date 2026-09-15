/* FlyPet Brain Lab: 3D connectome point cloud + live neural telemetry.
 * Rendering approach borrowed from Jhongdlp/FlyBrain web/src/cerebro.ts:
 * dim silhouette, colour only in active populations, glow trails. */
'use strict';

window.addEventListener('error', (e) => {
  const el = document.getElementById('err');
  if (el) el.textContent = `error: ${e.message ?? e.type}`;
});

const DN_COLORS = {
  DNp01_L: 0xff5252, DNp01_R: 0xff8a52,
  DNa02_L: 0x53c7ff, DNa02_R: 0x53a8ff,
  DNg100: 0x7dff6e, MDN: 0xc07dff,
};
const CH_COLORS = {
  chase_L: 0xffe066, chase_R: 0xffd21e,
  loom_L: 0xff7043, loom_R: 0xffab40,
  touch_L: 0x4dd0e1, touch_R: 0x26c6da, odor: 0xf06292,
};

// ---- three.js scene ---------------------------------------------------------

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.004);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 5000);
camera.position.set(0, 60, 260);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('scene').appendChild(renderer.domElement);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function pointsCloud(positions, color, size, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color, size, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  return new THREE.Points(geo, mat);
}

function normalize(pos) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let d = 0; d < 3; d++) {
      const v = pos[i + d];
      if (v < lo[d]) lo[d] = v;
      if (v > hi[d]) hi[d] = v;
    }
  }
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const scale = 180 / Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = (pos[i] - c[0]) * scale;
    pos[i + 1] = (pos[i + 1] - c[1]) * scale;
    pos[i + 2] = (pos[i + 2] - c[2]) * scale;
  }
  return pos;
}

// ---- data -------------------------------------------------------------------

const glow = {};          // "dn:DNp01_L" / "ch:chase_L" -> 0..1
const popPoints = {};     // key -> THREE.Points
const meta = { n: 0, real: false };

async function loadCloud() {
  const [pop, pos] = await Promise.all([
    fetch('populations').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch('positions').then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
  ]);

  let all, chans, dns;
  if (pos && pop) {
    const real = new Float32Array(pos);
    meta.n = real.length / 3;
    meta.real = true;
    all = normalize(real);
    const index = (list) => {
      const out = new Float32Array(list.length * 3);
      list.forEach((idx, i) => { out[i * 3] = all[idx * 3]; out[i * 3 + 1] = all[idx * 3 + 1]; out[i * 3 + 2] = all[idx * 3 + 2]; });
      return out;
    };
    chans = Object.fromEntries(Object.entries(pop.channels).map(([k, v]) => [k, index(v)]));
    dns = Object.fromEntries(Object.entries(pop.dn).map(([k, v]) => [k, index(v)]));
  } else {
    // mock backend: synthetic brain so the lab still works
    meta.n = 60000;
    all = syntheticAll();
    chans = {}, dns = {};
    for (const k of Object.keys(CH_COLORS)) chans[k] = syntheticCluster(all.length / 3, 140);
    for (const k of Object.keys(DN_COLORS)) dns[k] = syntheticCluster(all.length / 3, 90);
  }

  scene.add(pointsCloud(all, 0x39424f, 1.1, 0.9));
  for (const [k, arr] of Object.entries(chans)) {
    const p = pointsCloud(arr, CH_COLORS[k] ?? 0xffffff, 2.4, 0.0);
    popPoints[`ch:${k}`] = p; scene.add(p);
  }
  for (const [k, arr] of Object.entries(dns)) {
    const p = pointsCloud(arr, DN_COLORS[k] ?? 0xffffff, 3.2, 0.0);
    popPoints[`dn:${k}`] = p; scene.add(p);
  }
  buildBars();
  document.getElementById('meta').textContent =
    `${meta.real ? 'MaleCNS real positions' : 'synthetic layout (mock)'} · ${meta.n.toLocaleString()} neurons`;
}

function syntheticAll() {
  const out = new Float32Array(meta.n * 3);
  for (let i = 0; i < meta.n; i++) {
    out[i * 3] = (Math.random() - 0.5) * 200;
    out[i * 3 + 1] = (Math.random() - 0.5) * 120;
    out[i * 3 + 2] = (Math.random() - 0.5) * 120;
  }
  return out;
}

function syntheticCluster(n, size) {
  const c = [(Math.random() - 0.5) * 150, (Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90];
  const out = new Float32Array(size * 3);
  for (let i = 0; i < size; i++) {
    out[i * 3] = c[0] + (Math.random() - 0.5) * 18;
    out[i * 3 + 1] = c[1] + (Math.random() - 0.5) * 18;
    out[i * 3 + 2] = c[2] + (Math.random() - 0.5) * 18;
  }
  return out;
}

// ---- bars -------------------------------------------------------------------

function barRow(parent, key, label) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<div class="label">${label}</div><div class="bar"><div class="fill" id="f:${key}"></div></div><div class="val" id="v:${key}">0</div>`;
  parent.appendChild(row);
}

function buildBars() {
  const dn = document.getElementById('dn-bars');
  for (const k of Object.keys(DN_COLORS)) if (popPoints[`dn:${k}`]) barRow(dn, `dn:${k}`, k);
}

function updateBars(rates) {
  for (const k of Object.keys(DN_COLORS)) {
    const fill = document.getElementById(`f:dn:${k}`);
    if (!fill) continue;
    const rate = rates[k] ?? 0;
    fill.style.width = `${Math.min(100, (rate / 60) * 100)}%`;
    fill.classList.toggle('hot', rate >= 25);
    document.getElementById(`v:dn:${k}`).textContent = rate.toFixed(0);
  }
}

// ---- websocket --------------------------------------------------------------

const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
function connect() {
  const ws = new WebSocket(`${wsProto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'brain_telemetry') {
      updateBars(msg.rates ?? {});
      for (const [k, v] of Object.entries(msg.rates ?? {})) {
        if (popPoints[`dn:${k}`]) glow[`dn:${k}`] = Math.min(1.4, (v / 45) * 1.2);
      }
      for (const [k, v] of Object.entries(msg.stim ?? {})) {
        if (popPoints[`ch:${k}`]) glow[`ch:${k}`] = Math.min(1.2, v * 1.1);
      }
      document.getElementById('action').textContent = `${msg.action}  ·  ${msg.steps_per_s} steps/s`;
      document.getElementById('err').textContent = msg.error ?? '';
    }
  };
  ws.onclose = () => setTimeout(connect, 1500);
}

// ---- boot -------------------------------------------------------------------

loadCloud();
connect();

// ---- loop -------------------------------------------------------------------

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  for (const [k, p] of Object.entries(popPoints)) {
    glow[k] = (glow[k] ?? 0) * 0.92;
    p.material.opacity = Math.min(1, glow[k]);
  }
  renderer.render(scene, camera);
}
animate();
