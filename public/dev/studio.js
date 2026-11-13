import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPhone, textTex } from '../assets/phone-model.js';

const $ = s => document.querySelector(s);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = $('#lab'), box = canvas.parentElement;
const NAMES = ['Front Display Glass', 'Main Frame', 'Shielding and Brackets', 'Logic Board', 'Triple Rear Camera', 'Battery', 'Flex, Audio and Sensors', 'MagSafe Coil', 'Rear Glass Panel'];
const CODES = ['AP-DSP-01', 'AP-FRM-02', 'AP-SHD-03', 'AP-LGB-04', 'AP-CAM-05', 'AP-BAT-06', 'AP-FLX-07', 'AP-MAG-08', 'AP-BGL-09'];

/* renderer */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x060606, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x060606, 14, 30);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 80);
camera.position.set(5.2, 3.2, 6.4);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.06;
controls.enablePan = false; controls.minDistance = 1.6; controls.maxDistance = 16;
controls.autoRotate = !reduce; controls.autoRotateSpeed = 0.8;
controls.target.set(0, 0.2, 0);

/* lights */
const key = new THREE.SpotLight(0xffffff, 60, 30, 0.5, 0.6, 1.4); key.position.set(3, 9, 5); scene.add(key);
const rimL = new THREE.DirectionalLight(0xffffff, 1.4); rimL.position.set(-6, 3, -5); scene.add(rimL);
const rimR = new THREE.DirectionalLight(0xffffff, 0.9); rimR.position.set(6, 2, -4); scene.add(rimR);
scene.add(new THREE.AmbientLight(0xffffff, 0.15));

/* floor */
const glow = textTex(512, 512, (x, w) => { const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,.16)'); g.addColorStop(.5, 'rgba(255,255,255,.04)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -2.25; scene.add(floor);
const grid = new THREE.GridHelper(16, 32, 0xffffff, 0xffffff);
grid.material.transparent = true; grid.material.opacity = 0.06; grid.position.y = -2.24; scene.add(grid);
// orbit ring
const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.004, 6, 160), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }));
ring.rotation.x = Math.PI / 2; ring.position.y = -2.2; scene.add(ring);

/* model */
const { root, layers } = buildPhone();
root.rotation.x = -Math.PI / 2; root.position.y = 0.2;
scene.add(root);
layers.forEach(L => { L.edges.material.color.set(0xffffff); L.op = 1; L.eo = 0; });

/* state */
let explode = 0.35, explodeT = 0.35, blueprint = 0, blueprintT = 0, focus = -1, rig = 'orbit';
let tween = null;
const RIGS = {
  orbit: { pos: [5.2, 3.2, 6.4], tgt: [0, 0.2, 0], ex: 35, bp: false, ar: true, hud: { iso: 100, f: 2.8, mm: 50, s: 125 }, name: 'STUDIO' },
  top: { pos: [0, 10.5, 0.01], tgt: [0, 0, 0], ex: 100, bp: true, ar: false, hud: { iso: 64, f: 8.0, mm: 35, s: 60 }, name: 'BLUEPRINT' },
  macro: { pos: null, tgt: null, ex: 55, bp: false, ar: false, hud: { iso: 400, f: 1.4, mm: 100, s: 500 }, name: 'MACRO' }
};
const hudCur = { ...RIGS.orbit.hud }, hudT = { ...RIGS.orbit.hud };
const exSlider = $('#explode'), exVal = $('#exVal'), bpTog = $('#bpTog'), arTog = $('#arTog');

function layerY(i, e) { return root.position.y + layers[i].base + e * ((layers.length - 1) / 2 - layers[i].slot) * 0.42; }
function setBlueprint(on) { blueprintT = on ? 1 : 0; bpTog.setAttribute('aria-checked', on); }
function setAuto(on) { controls.autoRotate = on && !reduce; arTog.setAttribute('aria-checked', on); }
function setExplode(v) { explodeT = v / 100; exSlider.value = v; exVal.textContent = Math.round(v) + '%'; }
const ease = t => 1 - Math.pow(1 - t, 4);

function applyRig(name) {
  rig = name; const R = RIGS[name];
  document.querySelectorAll('[data-rig]').forEach(b => b.setAttribute('aria-pressed', b.dataset.rig === name));
  $('#rigName').textContent = R.name;
  setExplode(R.ex); setBlueprint(R.bp); setAuto(R.ar);
  Object.assign(hudT, R.hud);
  let pos, tgt;
  if (name === 'macro') {
    const y = layerY(1, R.ex / 100) - 0.15;
    tgt = new THREE.Vector3(0.3, y, -1.07); pos = tgt.clone().add(new THREE.Vector3(1.25, -0.9, 1.1));
    setFocus(1);
  } else { pos = new THREE.Vector3(...R.pos); tgt = new THREE.Vector3(...R.tgt); if (name === 'orbit') setFocus(-1); }
  tween = { t: 0, dur: reduce ? 0.01 : 1.6, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: tgt };
  $('#reticle').classList.toggle('on', name === 'macro');
  log(`<b>rig</b> camera preset: ${R.name.toLowerCase()} <em>(iso ${R.hud.iso}, f/${R.hud.f}, ${R.hud.mm}mm)</em>`);
}
document.querySelectorAll('[data-rig]').forEach(b => b.addEventListener('click', () => applyRig(b.dataset.rig)));
exSlider.addEventListener('input', () => setExplode(+exSlider.value));
bpTog.addEventListener('click', () => setBlueprint(blueprintT < 0.5));
arTog.addEventListener('click', () => setAuto(!controls.autoRotate));
controls.addEventListener('start', () => { tween = null; $('#hint').style.opacity = 0; });

/* focus layers */
const mini = $('#layersMini');
NAMES.forEach((n, i) => { const b = document.createElement('button'); b.innerHTML = `${n}<span>${CODES[i]}</span>`; b.onclick = () => setFocus(focus === i ? -1 : i, true); mini.appendChild(b); });
function setFocus(i, user) {
  focus = i; [...mini.children].forEach((b, j) => b.classList.toggle('on', j === i));
  if (user && i >= 0) log(`<b>inspect</b> layer ${CODES[i]}, ${NAMES[i]}`);
}
// click on mesh
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let downAt = null;
canvas.addEventListener('pointerdown', e => downAt = [e.clientX, e.clientY]);
canvas.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(root.children, true).find(h => h.object.isMesh && h.object.userData.id);
  if (hit) { const i = layers.findIndex(L => L.id === hit.object.userData.id); setFocus(focus === i ? -1 : i, true); }
});

/* resize */
function resize() { const w = box.clientWidth, h = box.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = camera.aspect < 0.8 ? 42 : 32; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(box); resize();

/* telemetry */
const T = { fps: $('#tFps'), ms: $('#tMs'), calls: $('#tCalls'), tris: $('#tTris'), az: $('#tAz'), el: $('#tEl'), rtt: $('#tRtt'), ord: $('#tOrd') };
const spark = $('#spark'), sctx = spark.getContext('2d'); const hist = [];
let frames = 0, acc = 0, lastStat = performance.now();
const setNum = (el, v, unit) => { el.innerHTML = `${v}${unit ? `<small>${unit}</small>` : ''}`; };
function drawSpark() {
  const w = spark.width, h = spark.height; sctx.clearRect(0, 0, w, h);
  sctx.strokeStyle = 'rgba(255,255,255,.12)'; sctx.beginPath(); sctx.moveTo(0, h - 0.5); sctx.lineTo(w, h - 0.5); sctx.stroke();
  sctx.strokeStyle = '#fff'; sctx.lineWidth = 1.2; sctx.beginPath();
  hist.forEach((v, i) => { const x = i / 59 * w, y = h - Math.min(1, v / 40) * (h - 4) - 2; i ? sctx.lineTo(x, y) : sctx.moveTo(x, y); }); sctx.stroke();
}

const CFG = window.ADP_CONFIG || {};
const API = String(CFG.apiBase || '').replace(/\/+$/, '');
const HEALTH = (CFG.endpoints && CFG.endpoints.health) || '/api/health';
let apiOk = null;
async function ping() {
  const t = performance.now();
  try {
    const r = await fetch(API + HEALTH, { cache: 'no-store' }); if (!r.ok) throw new Error(String(r.status)); const j = await r.json(); const ms = Math.round(performance.now() - t);
    setNum(T.rtt, ms, 'ms'); T.ord.textContent = j.orders ?? '--'; status(true, ms);
    if (Math.random() < 0.34 || apiOk !== true) log(`<b>health</b> order engine responded in ${ms} ms${Number.isFinite(j.orders) ? `, ${j.orders} orders on ledger` : ''}`);
    apiOk = true;
  } catch (e) { status(false); }
}
function status(ok, ms) {
  $('#sApi').textContent = ok ? `operational, ${ms} ms` : 'standby';
  $('#sApiDot').className = 'dot ' + (ok ? 'live' : 'off');
  if (!ok) { T.rtt.innerHTML = '--<small>ms</small>'; T.ord.textContent = '--'; if (apiOk !== false) log('<b>health</b> order engine on standby, desk orders continue on WhatsApp'); apiOk = false; }
  $('#navStatus').innerHTML = ok ? '<span class="dot live"></span><span>Systems nominal</span>' : '<span class="dot off"></span><span>Order engine standby</span>';
}
ping(); setInterval(ping, 4000);

/* desk hours (IST) */
function deskHours() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
  $('#clock').textContent = parts + ' IST';
  const h = +parts.slice(0, 2); const open = h >= 10 && h < 16;
  $('#sDesk').textContent = open ? 'team online, 10 AM to 4 PM' : 'after hours, auto-replies on';
  $('#sDeskDot').className = 'dot ' + (open ? 'live' : 'off');
}
deskHours(); setInterval(deskHours, 1000);

/* event log */
const logEl = $('#log'); const lines = [];
function log(html) {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
  lines.push(`<div><em>${t}</em>  ${html}</div>`); while (lines.length > 9) lines.shift(); logEl.innerHTML = lines.join('');
}
log('<b>session</b> studio initialised, webgl renderer online');
log(`<b>model</b> ${layers.length} layers loaded, ${layers.reduce((a, L) => a + L.mats.length, 0)} sub-components`);

/* pipeline */
const STEPS = [['Message intake', 'Text, photo or voice note on WhatsApp or Telegram.', 'IN-01'], ['Quote engine', 'One total price, delivery included, returned fast.', 'QT-02'], ['Verification gate', 'Advance checked by our team. No auto-approval.', 'VG-03'], ['Order ID issue', 'Unique 9-digit ID written to the ledger.', 'ID-04'], ['QC video hub', 'Parts tested, packed and filmed before dispatch.', 'QC-05'], ['Dispatch and drop', 'Balance cleared, parcel delivered to your shop.', 'DS-06']];
const pipe = $('#pipe');
STEPS.forEach((s, i) => { const d = document.createElement('div'); d.className = 'node'; d.innerHTML = `<div class="ix">0${i + 1}</div><small>${s[2]}</small><h4>${s[0]}</h4><p>${s[1]}</p>`; pipe.appendChild(d); });
const nodes = [...pipe.querySelectorAll('.node')], pulse = $('#pulse');
let pi = 0; function stepPipe() { nodes.forEach((n, i) => n.classList.toggle('hot', i === pi)); const x = 40 + pi / 5 * 920; pulse.setAttribute('x1', Math.max(40, x - 120)); pulse.setAttribute('x2', x); pi = (pi + 1) % 6; }
stepPipe(); if (!reduce) setInterval(stepPipe, 1400);

/* render loop */
const tag = $('#focusTag'), v3 = new THREE.Vector3(), bbox = new THREE.Box3();
const hudEl = { iso: $('#hIso'), f: $('#hF'), mm: $('#hMm'), s: $('#hS') };
let last = performance.now(), visible = true;
new IntersectionObserver(e => visible = e[0].isIntersecting).observe(box);
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!visible) return;
  const k = reduce ? 1 : 1 - Math.exp(-dt * 4);
  explode += (explodeT - explode) * k; blueprint += (blueprintT - blueprint) * k;

  if (tween) {
    tween.t += dt / tween.dur; const e = ease(Math.min(1, tween.t));
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (tween.t >= 1) tween = null;
  } else if (rig === 'macro') {
    controls.target.y += (layerY(1, explode) - 0.15 - controls.target.y) * k;
  }
  controls.update();

  layers.forEach((L, i) => {
    L.group.position.z = L.base + explode * (3.5 - L.slot) * 0.5;
    const dim = focus >= 0 && i !== focus;
    const op = (dim ? 0.12 : 1) * (1 - blueprint * 0.93);
    L.op += (op - L.op) * k;
    L.mats.forEach(m => { m.transparent = L.op < 0.995; m.opacity = L.op; m.depthWrite = L.op > 0.6; });
    const eo = Math.max(blueprint * (dim ? 0.25 : 0.85), focus === i ? 0.6 : 0);
    L.eo += (eo - L.eo) * k; L.edges.material.opacity = L.eo;
  });
  grid.material.opacity = 0.06 + blueprint * 0.12;
  ring.material.opacity = 0.18 * (1 - blueprint * 0.6);

  // focus tag
  if (focus >= 0) {
    bbox.setFromObject(layers[focus].group); bbox.getCenter(v3); v3.project(camera);
    if (v3.z < 1) {
      const x = (v3.x * 0.5 + 0.5) * box.clientWidth, y = (-v3.y * 0.5 + 0.5) * box.clientHeight;
      tag.textContent = `${CODES[focus]}  ${NAMES[focus].toUpperCase()}`;
      tag.style.transform = `translate(${Math.min(box.clientWidth - 220, x + 16)}px, ${y - 12}px)`; tag.style.left = '0'; tag.style.top = '0'; tag.style.opacity = 1;
    }
  } else tag.style.opacity = 0;

  // HUD
  for (const key in hudT) hudCur[key] += (hudT[key] - hudCur[key]) * Math.min(1, dt * 3);
  hudEl.iso.textContent = Math.round(hudCur.iso); hudEl.f.textContent = hudCur.f.toFixed(1); hudEl.mm.textContent = Math.round(hudCur.mm); hudEl.s.textContent = '1/' + Math.round(hudCur.s);

  renderer.render(scene, camera);

  // stats
  frames++; acc += dt;
  if (now - lastStat > 500) {
    const fps = frames / ((now - lastStat) / 1000), ms = 1000 / Math.max(fps, 1);
    setNum(T.fps, Math.round(fps), 'fps'); setNum(T.ms, ms.toFixed(1), 'ms');
    T.calls.textContent = renderer.info.render.calls; T.tris.textContent = renderer.info.render.triangles.toLocaleString('en-IN');
    const az = THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()), el = 90 - THREE.MathUtils.radToDeg(controls.getPolarAngle());
    setNum(T.az, Math.round((az + 360) % 360), '°'); setNum(T.el, Math.round(el), '°');
    hist.push(ms); while (hist.length > 60) hist.shift(); drawSpark();
    frames = 0; acc = 0; lastStat = now;
  }
}
requestAnimationFrame(frame);
