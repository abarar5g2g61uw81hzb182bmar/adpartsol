import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildPhone } from "./phone-model.js";
const hero = document.getElementById("top");
const pin = document.getElementById("heroPin");
const canvas = document.getElementById("heroCanvas");
const Q = new URLSearchParams(location.search);
const FIXED = Q.has("p") ? parseFloat(Q.get("p")) : null;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setClearColor(0, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = 0.95;
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
const key = new THREE.DirectionalLight(16777215, 1.6);
key.position.set(-4, 7, 7);
scene.add(key);
const rim = new THREE.DirectionalLight(16777215, 1.2);
rim.position.set(6, 3, -6);
scene.add(rim);
const fill = new THREE.DirectionalLight(16777215, 0.35);
fill.position.set(0, -4, 5);
scene.add(fill);
const { root, layers, textTex } = buildPhone();
layers.forEach((L) => {
  L.edges.visible = false;
});
const pivot = new THREE.Group();
pivot.add(root);
const lift = new THREE.Group();
lift.add(pivot);
scene.add(lift);
const shTex = textTex(256, 256, (x, w) => {
  const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, "rgba(8,8,8,.26)");
  g.addColorStop(0.5, "rgba(8,8,8,.08)");
  g.addColorStop(1, "rgba(8,8,8,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, w, w);
});
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);
const TAU = Math.PI * 2;
const KEYS = [
  { p: 0, yaw: -0.34, pitch: 0.04, roll: 0, ex: 0, rise: 0 },
  { p: 0.2, yaw: -0.2, pitch: 0.05, roll: 0, ex: 0, rise: 1 },
  { p: 0.42, yaw: Math.PI - 0.3, pitch: 0.07, roll: 0, ex: 0, rise: 1 },
  { p: 0.6, yaw: TAU, pitch: -0.98, roll: 0.62, ex: 0.08, rise: 1 },
  { p: 0.84, yaw: TAU, pitch: -0.98, roll: 0.62, ex: 1, rise: 1 },
  { p: 1, yaw: TAU + 0.14, pitch: -0.92, roll: 0.74, ex: 1, rise: 1 }
];
const KEYS_M = KEYS.map((k) => k.p < 0.6 ? k : { ...k, yaw: TAU + (k.p === 1 ? 0.08 : 0), pitch: k.p === 1 ? -1.06 : -1.12, roll: k.p === 1 ? 0.3 : 0.24 });
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function sample(p) {
  p = Math.min(1, Math.max(0, p));
  const K = mobile ? KEYS_M : KEYS;
  let i = 0;
  while (i < K.length - 2 && p > K[i + 1].p) i++;
  const a = K[i], b = K[i + 1], k = ease(Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p))));
  const o = {};
  for (const q of ["yaw", "pitch", "roll", "ex", "rise"]) o[q] = a[q] + (b[q] - a[q]) * k;
  return o;
}
let dragYaw = 0, dragPitch = 0, velYaw = 0, velPitch = 0, hovX = 0, hovY = 0, down = null, lastTouch = -1e9;
canvas.style.touchAction = "pan-y";
canvas.addEventListener("pointerdown", (e) => {
  down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), t0: performance.now(), touch: e.pointerType !== "mouse" };
  velYaw = velPitch = 0;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (_) {
  }
  pin.classList.add("grab");
});
canvas.addEventListener("pointermove", (e) => {
  if (down) {
    const now = performance.now(), dt = Math.max(8, now - down.t) / 1e3;
    const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
    const k = mobile ? 0.013 : 9e-3;
    dragYaw += dx * k;
    if (!down.touch) dragPitch = Math.max(-1.15, Math.min(1.15, dragPitch + dy * k * 0.8));
    velYaw = velYaw * 0.4 + dx * k / dt * 0.6;
    velPitch = down.touch ? 0 : velPitch * 0.4 + dy * k * 0.8 / dt * 0.6;
    down.lx = e.clientX;
    down.ly = e.clientY;
    down.t = now;
    lastTouch = now;
    return;
  }
  if (e.pointerType !== "mouse") return;
  const r = canvas.getBoundingClientRect();
  hovX = (e.clientX - r.left) / r.width - 0.5;
  hovY = (e.clientY - r.top) / r.height - 0.5;
});
const release = (e) => {
  if (down && e && e.type === "pointerup" && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t0 < 450) {
    velYaw = velPitch = 0;
    const id = pick(e.clientX, e.clientY);
    if (id) showPop(id, e.clientX, e.clientY);
    else hidePop();
  } else if (down && performance.now() - down.t > 90) {
    velYaw = 0;
    velPitch = 0;
  }
  down = null;
  lastTouch = performance.now();
  pin.classList.remove("grab");
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("pointerleave", () => {
  hovX = 0;
  hovY = 0;
});
const TILT = window.__tilt || { x: 0, y: 0 };
let gx = 0, gy = 0;
const T = () => Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
let distUp = 12, distEx = 16, mobile = false;
function resize() {
  const w = pin.clientWidth, h = pin.clientHeight;
  if (!w || !h) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio, w < 700 ? 2 : 1.75));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  mobile = w < 760;
  const t = T();
  distUp = Math.max(3 / ((mobile ? 0.66 : 0.72) * 2 * t), 1.5 / ((mobile ? 0.62 : 0.74) * 2 * t * camera.aspect));
  distEx = mobile ? Math.max(5.6 / (0.8 * 2 * t), 2.3 / (0.92 * 2 * t * camera.aspect)) : Math.max(5.2 / (0.84 * 2 * t), 3.6 / (0.9 * 2 * t * camera.aspect));
}
new ResizeObserver(resize).observe(pin);
resize();
function progress() {
  if (FIXED !== null) return FIXED;
  const r = hero.getBoundingClientRect(), span = r.height - innerHeight;
  return span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
}
let visible = true, last = performance.now(), sp = progress(), t0 = 0;
new IntersectionObserver((es) => {
  visible = es[0].isIntersecting;
}, { rootMargin: "120px" }).observe(hero);
document.addEventListener("visibilitychange", () => {
  last = performance.now();
});
const MID = (layers.length - 1) / 2;
const gap = () => mobile ? 0.5 : 0.44;
const SUBS = [];
layers.forEach((L) => {
  const def = L.group.children.find((c) => c.isMesh)?.userData.part;
  const rank = /* @__PURE__ */ new Map();
  L.group.children.forEach((c) => {
    if (c.isLineSegments) return;
    let part = c.userData.part;
    if (!part) c.traverse((o) => {
      if (!part && o.isMesh) part = o.userData.part;
    });
    const box = new THREE.Box3().setFromObject(c), ctr = box.getCenter(new THREE.Vector3());
    if (!rank.has(part)) rank.set(part, rank.size);
    SUBS.push({ o: c, L, part, base: c.position.clone(), cx: ctr.x, cy: ctr.y, k: rank.get(part), pop: 0, popT: 0 });
  });
});
const SPREAD = 0.2, LIFT = 0.028;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(root, true).find((h) => h.object.isMesh && h.object.visible && h.object.userData.part);
  return hit ? hit.object.userData.part : null;
}
const nameOf = (id) => {
  const P = window.ADP?.PARTS || [];
  const p = P.find((x) => x[0] === id);
  return p ? p[1] : null;
};
const pop = document.createElement("div");
pop.className = "hp-pop";
pop.setAttribute("role", "dialog");
pop.setAttribute("aria-live", "polite");
pop.innerHTML = '<button class="hp-x" type="button" aria-label="Close"><svg class="i" aria-hidden="true"><use href="#i-close"/></svg></button><p class="hp-name"></p><p class="hp-q">Want this part?</p><button class="btn btn-dark hp-dm" type="button"><svg class="i" aria-hidden="true"><use href="#i-tg"/></svg> DM us</button>';
pin.appendChild(pop);
const dot = document.createElement("i");
dot.className = "hp-dot";
dot.setAttribute("aria-hidden", "true");
pin.appendChild(dot);
const tip = document.createElement("div");
tip.className = "hp-tip";
tip.setAttribute("aria-hidden", "true");
pin.appendChild(tip);
const hint = document.createElement("div");
hint.className = "hp-hint";
hint.setAttribute("aria-hidden", "true");
hint.innerHTML = "<i></i>Tap any part";
pin.appendChild(hint);
let picked = null, popP = 0;
function showPop(id, cx, cy) {
  const name = nameOf(id);
  if (!name) return hidePop();
  picked = id;
  popP = sp;
  SUBS.forEach((S) => {
    S.popT = S.part === id ? 1 : 0;
  });
  pop.querySelector(".hp-name").textContent = name;
  const r = pin.getBoundingClientRect(), x = cx - r.left, y = cy - r.top;
  dot.style.transform = `translate(${x}px,${y}px)`;
  dot.classList.remove("on");
  void dot.offsetWidth;
  dot.classList.add("on");
  pop.classList.add("on");
  const pw = pop.offsetWidth, ph = pop.offsetHeight, m = 14;
  let px = x - pw / 2, py = y - ph - 22;
  if (py < 76) py = y + 26;
  px = Math.max(m, Math.min(r.width - pw - m, px));
  py = Math.max(76, Math.min(r.height - ph - 90, py));
  pop.style.transform = `translate(${px}px,${py}px)`;
  navigator.vibrate?.(8);
}
function hidePop() {
  picked = null;
  pop.classList.remove("on");
  dot.classList.remove("on");
  SUBS.forEach((S) => {
    S.popT = 0;
  });
}
pop.querySelector(".hp-x").addEventListener("click", hidePop);
pop.querySelector(".hp-dm").addEventListener("click", () => {
  const id = picked;
  hidePop();
  window.ADP?.openPart(id);
});
let hovT = 0;
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || down) return;
  const now = performance.now();
  if (now - hovT < 70) return;
  hovT = now;
  const id = pick(e.clientX, e.clientY), name = id && nameOf(id);
  canvas.style.cursor = name ? "pointer" : "";
  if (name) {
    const r = pin.getBoundingClientRect();
    tip.textContent = name;
    tip.style.transform = `translate(${e.clientX - r.left + 16}px,${e.clientY - r.top + 18}px)`;
    tip.classList.add("on");
  } else tip.classList.remove("on");
});
canvas.addEventListener("pointerleave", () => tip.classList.remove("on"));
window.addEventListener("scroll", () => {
  if (picked && Math.abs(progress() - popP) > 0.04) hidePop();
}, { passive: true });
const L_SIGN = (L) => L.slot <= MID ? 1 : -1;
function frame(now) {
  requestAnimationFrame(frame);
  if (!visible || document.hidden) {
    last = now;
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1e3);
  last = now;
  t0 += dt;
  const target = progress();
  sp += (target - sp) * (FIXED !== null || reduce ? 1 : 1 - Math.exp(-dt * 7));
  const s = sample(sp);
  hero.style.setProperty("--hp", sp.toFixed(4));
  hero.classList.toggle("copy-off", sp > 0.2);
  const W = window.__tilt || TILT;
  gx += ((W.x || 0) - gx) * (1 - Math.exp(-dt * 6));
  gy += ((W.y || 0) - gy) * (1 - Math.exp(-dt * 6));
  if (!down) {
    dragYaw += velYaw * dt;
    dragPitch = Math.max(-1.15, Math.min(1.15, dragPitch + velPitch * dt));
    velYaw *= Math.exp(-dt * 2.2);
    velPitch *= Math.exp(-dt * 2.6);
    if (now - lastTouch > 2600) {
      const home = Math.round(dragYaw / TAU) * TAU;
      dragYaw += (home - dragYaw) * (1 - Math.exp(-dt * 0.9));
      dragPitch *= Math.exp(-dt * 1);
    }
  }
  const still = reduce || FIXED !== null;
  const idleYaw = still ? 0 : (1 - s.ex * 0.6) * Math.sin(t0 * 0.42) * 0.26;
  const idlePitch = still ? 0 : Math.sin(t0 * 0.33 + 1.2) * 0.07;
  const idleRoll = still ? 0 : Math.sin(t0 * 0.27 + 0.4) * 0.05;
  const gyroOn = !!W.gyro;
  pivot.rotation.set(
    s.pitch + dragPitch + idlePitch + hovY * 0.32 + gy * (gyroOn ? 0.55 : 0.2),
    s.yaw + idleYaw + dragYaw + hovX * 0.55 + gx * (gyroOn ? 0.75 : 0.3),
    s.roll + idleRoll
  );
  const G = gap(), kp = 1 - Math.exp(-dt * 9);
  layers.forEach((L) => {
    L.group.position.z = (MID - L.slot) * G * s.ex;
  });
  SUBS.forEach((S) => {
    S.pop += (S.popT - S.pop) * kp;
    const sub = S.k ? s.ex : 0, dir = L_SIGN(S.L);
    S.o.position.set(S.base.x + S.cx * SPREAD * sub, S.base.y + S.cy * SPREAD * sub, S.base.z + dir * (S.k * LIFT * s.ex + S.pop * 0.14));
  });
  pin.classList.toggle("exploded", s.ex > 0.7 && !picked);
  const dist = distUp + (distEx - distUp) * s.ex;
  const vh = 2 * dist * T();
  const low = -(mobile ? 0.17 : 0.11) * vh - 1.5;
  const bob = reduce || FIXED !== null ? 0 : Math.sin(t0 * 0.8) * 0.06;
  lift.position.y = low * (1 - s.rise) + bob;
  camera.position.set(gx * 0.35 * (gyroOn ? 1 : 0.4), 0.25 + s.ex * 0.2 - gy * 0.25 * (gyroOn ? 1 : 0.4), dist);
  camera.lookAt(0, 0, 0);
  const floorY = lift.position.y - 1.7 - s.ex * 0.9;
  shadow.position.set(0, floorY, 0);
  shadow.scale.set(2.4 + s.ex * 2.2, 1 + s.ex * 1.2, 1);
  shadow.material.opacity = (0.35 + 0.65 * s.rise) * (1 - s.ex * 0.2);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
pin.classList.add("ready");
