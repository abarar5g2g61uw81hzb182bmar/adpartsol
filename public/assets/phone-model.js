import * as THREE from 'three';
/*
  AD PARTSOL device model, 18 Pro class handset.
  Scale: 1 unit = 50 mm. Body 150.0 x 71.9 x 8.75 mm.
  Local axes: +z = display side, -z = back. +y = top.
  Layers keep a fixed explode slot (front to back) independent of catalogue order.
*/
const W = 71.9 / 50, H = 150 / 50, D = 8.75 / 50, R = 0.245;
const BS = 0.032, BT = 0.05;               // frame bevel size / thickness
const CAP_W = W - 2 * BS, CAP_H = H - 2 * BS, CAP_R = R - BS;
const WALL = 0.03;

/* ---------- shape helpers (continuous corners) ---------- */
function shapeRR(w, h, rt, rb = rt, cx = 0, cy = 0, PathCls = THREE.Shape) {
  const s = new PathCls(), l = cx - w / 2, r = cx + w / 2, b = cy - h / 2, t = cy + h / 2;
  const A = x => Math.min(x * 1.22, w / 2 - 1e-4, h / 2 - 1e-4), C = x => x * 0.3;
  const ab = A(rb), at = A(rt), cb = C(rb), ct = C(rt);
  s.moveTo(l + ab, b); s.lineTo(r - ab, b); s.bezierCurveTo(r - cb, b, r, b + cb, r, b + ab);
  s.lineTo(r, t - at); s.bezierCurveTo(r, t - ct, r - ct, t, r - at, t);
  s.lineTo(l + at, t); s.bezierCurveTo(l + ct, t, l, t - ct, l, t - at);
  s.lineTo(l, b + ab); s.bezierCurveTo(l, b + cb, l + cb, b, l + ab, b);
  return s;
}
function ext(shape, depth, bt = 0, bs = 0, segs = 6, curve = 28) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bt > 0, bevelThickness: bt, bevelSize: bs, bevelSegments: segs, curveSegments: curve });
  g.translate(0, 0, -depth / 2); return g;
}
function normUV(geo) {
  geo.computeBoundingBox(); const bb = geo.boundingBox, p = geo.attributes.position, uv = geo.attributes.uv;
  const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - bb.min.x) / w, (p.getY(i) - bb.min.y) / h);
  uv.needsUpdate = true; return geo;
}
export function textTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
/* minimal SVG path reader (M L H V C S Z, absolute + relative) -> THREE.Shape[] with y up */
function svgShapes(d) {
  const tk = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g); const out = [];
  let i = 0, cmd = '', s = null, x = 0, y = 0, x0 = 0, y0 = 0, px = 0, py = 0;
  const n = () => parseFloat(tk[i++]);
  while (i < tk.length) {
    if (/[a-zA-Z]/.test(tk[i])) cmd = tk[i++];
    const r = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === 'Z') { s.closePath(); x = x0; y = y0; continue; }
    if (C === 'M') { x = (r ? x : 0) + n(); y = (r ? y : 0) + n(); s = new THREE.Shape(); out.push(s); s.moveTo(x, -y); x0 = x; y0 = y; cmd = r ? 'l' : 'L'; px = x; py = y; continue; }
    if (C === 'L') { x = (r ? x : 0) + n(); y = (r ? y : 0) + n(); s.lineTo(x, -y); px = x; py = y; continue; }
    if (C === 'H') { x = (r ? x : 0) + n(); s.lineTo(x, -y); px = x; py = y; continue; }
    if (C === 'V') { y = (r ? y : 0) + n(); s.lineTo(x, -y); px = x; py = y; continue; }
    if (C === 'C' || C === 'S') {
      let ax, ay;
      if (C === 'C') { ax = (r ? x : 0) + n(); ay = (r ? y : 0) + n(); } else { ax = 2 * x - px; ay = 2 * y - py; }
      const bx = (r ? x : 0) + n(), by = (r ? y : 0) + n(), ex = (r ? x : 0) + n(), ey = (r ? y : 0) + n();
      s.bezierCurveTo(ax, -ay, bx, -by, ex, -ey); px = bx; py = by; x = ex; y = ey; continue;
    }
    i++;
  }
  return out;
}
const APPLE = 'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z';
export function appleLogoGeometry(height) {
  const g = new THREE.ShapeGeometry(svgShapes(APPLE), 28); g.computeBoundingBox();
  const b = g.boundingBox, c = b.getCenter(new THREE.Vector3()), k = height / (b.max.y - b.min.y);
  g.translate(-c.x, -c.y, 0); g.scale(k, k, 1); return g;
}
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ---------- bead-blast grain: shared roughness map that gives metal a real matte tooth ---------- */
let GRAIN = null;
export function grain() {
  if (GRAIN) return GRAIN;
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const img = x.createImageData(256, 256), d = img.data, r = seeded(23);
  for (let i = 0; i < d.length; i += 4) { const v = 200 + (r() - 0.5) * 70; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  GRAIN = new THREE.CanvasTexture(c); GRAIN.wrapS = GRAIN.wrapT = THREE.RepeatWrapping; GRAIN.repeat.set(3, 6);
  return GRAIN;
}

/* ---------- Apple's official 18 Pro back photo, mapped onto the real back surfaces ---------- */
export const BACK_PHOTO = 'https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/iphone-18-pro-finish-select-black-202609?wid=1600&hei=1600&fmt=jpeg&qlt=90';
const BACK_LOCAL = new URL('./rear-18pro.webp', import.meta.url).href;
// where the back-facing phone sits inside Apple's 1600px finish image (fractions)
const CROP = { x0: 0.1875, y0: 0.1542, y1: 0.9083 };
let photoP = null;
function loadImg(src) {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; im.onload = () => res(im); im.onerror = rej; im.src = src; });
}
export function backPhoto() {
  if (photoP) return photoP;
  photoP = (async () => {
    let im, crop;
    try { im = await loadImg(BACK_PHOTO); const hh = (CROP.y1 - CROP.y0) * im.height, ww = hh / 2.0715; crop = [CROP.x0 * im.width, CROP.y0 * im.height, ww, hh]; }
    catch (_) { im = await loadImg(BACK_LOCAL); crop = [0, 0, im.width, im.height]; }
    const c = document.createElement('canvas'); c.width = 1024; c.height = 2048;
    const x = c.getContext('2d'); x.drawImage(im, crop[0], crop[1], crop[2], crop[3], 0, 0, c.width, c.height);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  })();
  return photoP;
}
// planar UVs in phone space, seen from the back (mirrored x)
function backUV(geo) {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 - p.getX(i) / W, 0.5 + p.getY(i) / H);
  uv.needsUpdate = true; return geo;
}

/* ---------- materials (matte) ---------- */
const MAT = {
  body: () => new THREE.MeshPhysicalMaterial({ color: 0x2b2b2d, metalness: 0.78, roughness: 0.5, roughnessMap: grain(), metalnessMap: null }),
  bodyFine: () => new THREE.MeshPhysicalMaterial({ color: 0x2f2f31, metalness: 0.82, roughness: 0.4, roughnessMap: grain() }),
  band: () => new THREE.MeshStandardMaterial({ color: 0x18191b, metalness: 0.1, roughness: 0.7 }),
  glassFront: () => new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.22, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.18 }),
  glassBack: () => new THREE.MeshPhysicalMaterial({ color: 0x2a2b2e, roughness: 0.5, metalness: 0.35, clearcoat: 0.25, clearcoatRoughness: 0.45 }), // colour matched to the unibody (18 Pro)
  lensGlass: () => new THREE.MeshPhysicalMaterial({ color: 0x040405, roughness: 0.06, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }),
  coating: () => new THREE.MeshPhysicalMaterial({ color: 0x07070b, roughness: 0.05, metalness: 0.3, iridescence: 0.3, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 520], clearcoat: 1 }),
  lensRing: () => new THREE.MeshStandardMaterial({ color: 0x5a5b5f, metalness: 0.9, roughness: 0.3 }),
  black: () => new THREE.MeshStandardMaterial({ color: 0x060606, metalness: 0.1, roughness: 0.62 }),
  pcb: () => new THREE.MeshStandardMaterial({ color: 0x141516, metalness: 0.25, roughness: 0.66 }),
  shield: () => new THREE.MeshStandardMaterial({ color: 0x9a9ca0, metalness: 0.9, roughness: 0.56, roughnessMap: grain() }),
  chip: () => new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0.3, roughness: 0.4 }),
  steel: () => new THREE.MeshStandardMaterial({ color: 0xb9bbbe, metalness: 1, roughness: 0.46, roughnessMap: grain() }),
  foil: () => new THREE.MeshStandardMaterial({ color: 0x55575b, metalness: 0.62, roughness: 0.52 }),
  flex: () => new THREE.MeshStandardMaterial({ color: 0x1e1f21, metalness: 0.2, roughness: 0.55 }),
  coil: () => new THREE.MeshStandardMaterial({ color: 0x8c8e92, metalness: 0.95, roughness: 0.44, roughnessMap: grain() }),
  ferrite: () => new THREE.MeshStandardMaterial({ color: 0x101012, metalness: 0.1, roughness: 0.8 }),
  flash: () => new THREE.MeshStandardMaterial({ color: 0xd9d7d0, metalness: 0, roughness: 0.72 }),
  logo: () => new THREE.MeshPhysicalMaterial({ color: 0x9a9ca0, metalness: 1, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05 }),
  graphite: () => new THREE.MeshStandardMaterial({ color: 0x232325, metalness: 0.35, roughness: 0.58 }),
  emi: () => new THREE.MeshStandardMaterial({ color: 0x7d7f83, metalness: 0.85, roughness: 0.52, roughnessMap: grain() }),
  sensor: () => new THREE.MeshPhysicalMaterial({ color: 0x0d0f14, metalness: 0.4, roughness: 0.12, clearcoat: 1, iridescence: 0.25, iridescenceIOR: 1.6 }),
  antenna: () => new THREE.MeshStandardMaterial({ color: 0x3a3b3e, metalness: 0.4, roughness: 0.5 })
};

/* ---------- textures ---------- */
function wallpaper() {
  return textTex(800, 1740, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w * 0.4, h); g.addColorStop(0, '#202023'); g.addColorStop(0.55, '#0c0c0d'); g.addColorStop(1, '#040404');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const fold = (pts, a, blur) => {
      x.save(); x.filter = `blur(${blur}px)`; x.beginPath(); x.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 6) x.bezierCurveTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5]);
      x.closePath(); const lg = x.createLinearGradient(0, h * 0.2, w, h * 0.8);
      lg.addColorStop(0, `rgba(255,255,255,${a})`); lg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = lg; x.fill(); x.restore();
    };
    fold([-100, h * 0.62, w * 0.3, h * 0.38, w * 0.62, h * 0.52, w + 120, h * 0.26, w + 120, h * 0.42, w * 0.6, h * 0.72, -100, h * 0.9], 0.16, 40);
    fold([-100, h * 0.78, w * 0.4, h * 0.56, w * 0.7, h * 0.7, w + 100, h * 0.56, w + 100, h * 0.66, w * 0.5, h * 0.9, -100, h * 1.02], 0.1, 26);
    fold([w * 0.1, h * 0.2, w * 0.5, h * 0.05, w * 0.8, h * 0.3, w + 50, h * 0.12, w + 60, h * 0.22, w * 0.6, h * 0.42, w * 0.1, h * 0.3], 0.06, 60);
    const img = x.getImageData(0, 0, w, h), d = img.data, rnd = seeded(7);
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 9; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(img, 0, 0);
    // dynamic island
    const iw = w * 0.205, ih = w * 0.074;  // smaller Dynamic Island (18 Pro)
    x.fillStyle = '#000'; x.beginPath(); x.roundRect((w - iw) / 2, w * 0.036, iw, ih, ih / 2); x.fill();
  });
}
function pcbTex() {
  const t = textTex(512, 512, (x, w, h) => {
    x.fillStyle = '#141516'; x.fillRect(0, 0, w, h); const r = seeded(11);
    x.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      x.strokeStyle = `rgba(150,152,156,${0.05 + r() * 0.09})`; x.lineWidth = 1 + r() * 2;
      let px = r() * w, py = r() * h; x.beginPath(); x.moveTo(px, py);
      for (let k = 0; k < 4; k++) { if (r() > 0.5) px += (r() - 0.5) * 220; else py += (r() - 0.5) * 220; x.lineTo(px, py); }
      x.stroke();
    }
    for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(190,192,196,${0.08 + r() * 0.14})`; x.beginPath(); x.arc(r() * w, r() * h, 1.6 + r() * 1.6, 0, 7); x.fill(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.6, 1.6); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---------- side-profile strip (antenna bands) ---------- */
function sideProfile(bandW) {
  const xo = CAP_W / 2, xi = xo - WALL * 0.9, dh = (D - 2 * BT) / 2, off = 0.0016;
  const s = new THREE.Shape(); s.moveTo(xi, -D / 2 - off); s.lineTo(xo, -D / 2 - off);
  const N = 10;
  for (let i = 1; i <= N; i++) { const t = i / N; s.lineTo(xo + (BS + off) * Math.sin(t * Math.PI / 2), -(dh + (BT + off) * Math.cos(t * Math.PI / 2))); }
  for (let i = 0; i <= N; i++) { const t = 1 - i / N; s.lineTo(xo + (BS + off) * Math.sin(t * Math.PI / 2), dh + (BT + off) * Math.cos(t * Math.PI / 2)); }
  s.lineTo(xi, D / 2 + off); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: bandW, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -bandW / 2); g.rotateX(-Math.PI / 2); return g; // x = outward, y = band axis
}

export function buildPhone(opts = {}) {
  const layers = [], photo = []; let photoLogo = null;
  const root = new THREE.Group();
  function makeLayer(id, slot, edgeGeo, build, part = id) {
    const g = new THREE.Group(); g.userData.id = id; build(g);
    const mats = [];
    g.traverse(o => {
      if (!o.isMesh) return;
      o.userData.id = id; if (!mats.includes(o.material)) mats.push(o.material);
      let p = o, tag = null; while (p && p !== g && !tag) { tag = p.userData.part; p = p.parent; }
      o.userData.part = tag || part;
    });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(edgeGeo, 32), new THREE.LineBasicMaterial({ color: 0x080808, transparent: true, opacity: 0 }));
    g.add(edges);
    const L = { id, slot, group: g, mats, edges, op: 1, base: 0 };
    layers.push(L); root.add(g); return L;
  }
  // tag everything a block adds to a layer group with a catalogue part id
  const T = (g, part, fn) => { const n0 = g.children.length; fn(); for (let i = n0; i < g.children.length; i++) if (!g.children[i].userData.part) g.children[i].userData.part = part; };
  const cyl = (g, r, h, mat, x, y, z, seg = 32) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); g.add(m); return m; };
  const screwAt = (g, x, y, z, r = 0.011) => { const st = MAT.steel(); cyl(g, r, 0.008, st, x, y, z, 20); box(g, r * 1.1, 0.0025, 0.002, MAT.chip(), x, y, z + 0.0045); box(g, 0.0025, r * 1.1, 0.002, MAT.chip(), x, y, z + 0.0045); };
  const add = (g, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  const box = (g, w, h, d, mat, x, y, z) => add(g, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const rbox = (g, w, h, d, r, mat, x, y, z, bev = 0.004) => add(g, ext(shapeRR(w, h, r, r, x, y), Math.max(0.001, d - 2 * bev), bev, bev, 3, 10), mat, 0, 0, z);

  /* ===== 1. Display assembly ===== */
  const glassShape = shapeRR(CAP_W - 0.012, CAP_H - 0.012, CAP_R - 0.006);
  const glassGeo = ext(glassShape, 0.014, 0.006, 0.006, 5, 40);
  const SCR_TOP = D / 2 + 0.014;
  const screenTex = { map: null };
  makeLayer('oled', 0, glassGeo, g => {
    add(g, glassGeo, MAT.glassFront(), 0, 0, D / 2 + 0.001);
    const sw = CAP_W - 0.07, sh = CAP_H - 0.07;
    const sGeo = normUV(new THREE.ShapeGeometry(shapeRR(sw, sh, CAP_R - 0.035), 40));
    const sMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0 });
    screenTex.mat = sMat;
    add(g, sGeo, sMat, 0, 0, SCR_TOP + 0.0008);
    // earpiece slit
    const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.0035, 0.12, 4, 12), MAT.black()); ear.rotation.z = Math.PI / 2; ear.scale.z = 0.3; ear.position.set(0, CAP_H / 2 - 0.014, SCR_TOP + 0.0006); g.add(ear);
    // OLED panel underside (visible when separated)
    const panel = add(g, ext(shapeRR(sw + 0.01, sh + 0.01, CAP_R - 0.03), 0.006), MAT.black(), 0, 0, D / 2 - 0.016);
    T(g, 'disp-conn', () => {
      box(g, 0.34, 0.24, 0.004, MAT.flex(), -0.1, -0.95, D / 2 - 0.021);
      box(g, 0.1, 0.62, 0.004, MAT.flex(), -0.32, -0.6, D / 2 - 0.022);
      rbox(g, 0.16, 0.07, 0.012, 0.01, MAT.steel(), -0.32, -0.26, D / 2 - 0.028);
      box(g, 0.12, 0.04, 0.004, MAT.chip(), -0.32, -0.26, D / 2 - 0.036);
    });
  }, 'display');
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  fontsReady.then(() => { screenTex.mat.emissiveMap = wallpaper(); screenTex.mat.needsUpdate = true; });

  /* ===== 2. Logic board (stacked) ===== */
  const boardShape = (() => {
    const s = new THREE.Shape(); const r = 0.03;
    const P = [[-0.6, 0.2], [0.6, 0.2], [0.6, 0.64], [-0.06, 0.64], [-0.06, 1.38], [-0.6, 1.38]];
    s.moveTo(P[0][0] + r, P[0][1]); s.lineTo(P[1][0] - r, P[1][1]); s.quadraticCurveTo(P[1][0], P[1][1], P[1][0], P[1][1] + r);
    s.lineTo(P[2][0], P[2][1] - r); s.quadraticCurveTo(P[2][0], P[2][1], P[2][0] - r, P[2][1]);
    s.lineTo(P[3][0] + r, P[3][1]); s.quadraticCurveTo(P[3][0], P[3][1], P[3][0], P[3][1] + r);
    s.lineTo(P[4][0], P[4][1] - r); s.quadraticCurveTo(P[4][0], P[4][1], P[4][0] - r, P[4][1]);
    s.lineTo(P[5][0] + r, P[5][1]); s.quadraticCurveTo(P[5][0], P[5][1], P[5][0], P[5][1] - r);
    s.lineTo(P[0][0], P[0][1] + r); s.quadraticCurveTo(P[0][0], P[0][1], P[0][0] + r, P[0][1]); return s;
  })();
  const boardGeo = ext(boardShape, 0.01, 0.002, 0.002, 2, 8);
  makeLayer('board', 2, boardGeo, g => {
    const pm = MAT.pcb(); pm.map = pcbTex();
    add(g, boardGeo, pm, 0, 0, 0.008);
    add(g, boardGeo, pm, 0, 0, 0.044);
    // interposer walls
    const ip = MAT.chip();
    [[-0.33, 0.22, 0.54, 0.012], [-0.33, 1.36, 0.54, 0.012], [-0.59, 0.79, 0.012, 1.14], [-0.07, 1.0, 0.012, 0.72], [0.27, 0.22, 0.66, 0.012], [0.59, 0.42, 0.012, 0.4], [0.27, 0.62, 0.66, 0.012]].forEach(([x, y, w, h]) => box(g, w, h, 0.03, ip, x, y, 0.026));
    const sh = MAT.shield(), ch = MAT.chip(), st = MAT.steel();
    const Z = 0.05;
    T(g, 'rf-shield', () => {
      rbox(g, 0.34, 0.32, 0.018, 0.025, sh, -0.33, 1.06, Z + 0.009);   // SoC shield
      rbox(g, 0.2, 0.18, 0.014, 0.02, sh, -0.37, 0.66, Z + 0.007);
      rbox(g, 0.36, 0.26, 0.014, 0.02, sh, 0.3, 0.42, Z + 0.007);      // modem
      rbox(g, 0.16, 0.14, 0.012, 0.015, sh, -0.17, 0.4, Z + 0.006);
    });
    rbox(g, 0.12, 0.1, 0.01, 0.01, ch, -0.5, 0.36, Z + 0.005);
    // board-to-board connectors
    [[-0.18, 1.3, 0.16], [-0.5, 1.28, 0.12], [-0.45, 0.88, 0.14], [0.06, 0.52, 0.16], [0.5, 0.56, 0.1]].forEach(([x, y, w]) => {
      rbox(g, w, 0.045, 0.012, 0.006, ch, x, y, Z + 0.006);
      for (let i = 0; i < 7; i++) box(g, 0.004, 0.03, 0.002, st, x - w / 2 + 0.012 + i * (w - 0.024) / 6, y, Z + 0.013);
    });
    // passives
    const rnd = seeded(5);
    for (let i = 0; i < 46; i++) {
      const x = -0.56 + rnd() * 0.46, y = 0.24 + rnd() * 1.1;
      if (x > -0.52 && x < -0.14 && y > 0.86 && y < 1.26) continue;
      const big = rnd() > 0.8; box(g, big ? 0.03 : 0.016, big ? 0.018 : 0.01, 0.008, rnd() > 0.5 ? ch : st, x, y, Z + 0.004);
    }
    for (let i = 0; i < 24; i++) { const x = 0.0 + rnd() * 0.56, y = 0.24 + rnd() * 0.36; if (x > 0.1 && y > 0.28 && y < 0.56) continue; box(g, 0.016, 0.01, 0.008, rnd() > 0.5 ? ch : st, x, y, Z + 0.004); }
    // flex tails
    box(g, 0.06, 0.34, 0.003, MAT.flex(), -0.42, 0.04, 0.03);
    box(g, 0.05, 0.26, 0.003, MAT.flex(), 0.4, 0.06, 0.03);
  });

  /* ===== 3. Camera optics ===== */
  const PLAT_Y0 = 0.64, LENSES = [[0.433, 1.215, 'main'], [0.433, 0.828, 'wide'], [0.061, 1.026, 'tele']]  // matched to Apple's official 18 Pro back photo;
  const camBracket = shapeRR(0.72, 0.78, 0.08, 0.08, 0.3, 1.07);
  const camGeo = ext(camBracket, 0.008, 0.002, 0.002, 2, 12);
  makeLayer('camera', 3, camGeo, g => {
    T(g, 'cam-housing', () => {
      add(g, camGeo, MAT.steel(), 0, 0, 0.012);
      [[0.62, 1.4], [-0.02, 1.4], [0.62, 0.74], [-0.02, 0.74]].forEach(([x, y]) => screwAt(g, x, y, 0.02, 0.012));
    });
    const hm = MAT.bodyFine(), bl = MAT.black(), lg = MAT.lensGlass();
    LENSES.forEach(([x, y, k]) => {
      const s = k === 'main' ? 0.3 : 0.24, d = k === 'main' ? 0.07 : 0.055;
      if (k === 'tele') rbox(g, 0.26, 0.3, d, 0.03, hm, x, y, -0.02);
      else rbox(g, s, s, d, 0.035, hm, x, y, -0.02);
      const br = new THREE.Mesh(new THREE.CylinderGeometry(k === 'main' ? 0.11 : 0.09, k === 'main' ? 0.11 : 0.09, 0.03, 48), bl); br.rotation.x = Math.PI / 2; br.position.set(x, y, -0.065); g.add(br);
      const lc = new THREE.Mesh(new THREE.CylinderGeometry(k === 'main' ? 0.085 : 0.068, k === 'main' ? 0.085 : 0.068, 0.006, 48), lg); lc.rotation.x = Math.PI / 2; lc.position.set(x, y, -0.081); g.add(lc);
      // image sensor assembly behind each module
      T(g, 'sensor-asm', () => {
        rbox(g, s * 0.86, s * 0.86, 0.012, 0.02, MAT.pcb(), x, y, 0.03);
        rbox(g, s * 0.5, s * 0.42, 0.006, 0.008, MAT.sensor(), x, y, 0.039);
        rbox(g, s * 0.62, s * 0.54, 0.004, 0.01, MAT.shield(), x, y, 0.037);
      });
      // sensor flex up toward board
      T(g, 'cam-flex', () => {
        box(g, 0.08, 0.2, 0.003, MAT.flex(), x - 0.08, y - 0.08, 0.034);
        rbox(g, 0.1, 0.05, 0.01, 0.008, MAT.steel(), x - 0.08, y - 0.2, 0.038);
      });
    });
    T(g, 'sensors', () => {
      rbox(g, 0.12, 0.12, 0.03, 0.02, bl, -0.444, 0.82, -0.02); // LiDAR scanner
      cyl(g, 0.032, 0.008, MAT.lensGlass(), -0.444, 0.82, -0.038, 32);
    });
    T(g, 'flash', () => {
      rbox(g, 0.13, 0.13, 0.012, 0.02, MAT.pcb(), -0.448, 1.236, 0.0);
      rbox(g, 0.07, 0.07, 0.01, 0.012, MAT.flash(), -0.448, 1.236, -0.01);
      box(g, 0.04, 0.16, 0.003, MAT.flex(), -0.448, 1.09, 0.004);
    });
    T(g, 'cam-flex', () => {
      box(g, 0.05, 0.42, 0.003, MAT.flex(), -0.1, 0.9, 0.034);
      rbox(g, 0.14, 0.05, 0.01, 0.008, MAT.steel(), -0.1, 0.68, 0.038);
    });
  }, 'camera-module');

  /* ===== 4. Battery ===== */
  const batShape = shapeRR(1.18, 1.32, 0.06, 0.06, 0, -0.5);
  const batGeo = ext(batShape, 0.044, 0.006, 0.006, 4, 16);
  makeLayer('battery', 4, batGeo, g => {
    add(g, batGeo, MAT.foil(), 0, 0, 0.004);
    T(g, 'bat-conn', () => {
      rbox(g, 0.3, 0.12, 0.012, 0.02, MAT.black(), -0.36, 0.2, 0.03);       // BMS
      box(g, 0.08, 0.18, 0.003, MAT.flex(), -0.36, 0.3, 0.03);
      rbox(g, 0.12, 0.06, 0.014, 0.008, MAT.steel(), -0.36, 0.41, 0.034);
      box(g, 0.09, 0.03, 0.004, MAT.chip(), -0.36, 0.41, 0.043);
    });
    [-0.3, 0, 0.3].forEach(x => box(g, 0.1, 0.12, 0.002, MAT.black(), x, -1.2, 0.03));      // pull tabs
    rbox(g, 1.06, 1.2, 0.002, 0.04, MAT.steel(), 0, -0.5, 0.0315);   // thin label sheet
    g.children.at(-1).material = new THREE.MeshStandardMaterial({ color: 0x6b6d71, metalness: 0.5, roughness: 0.6 });
  }, 'battery');

  /* ===== 5. Taptic engine + speaker ===== */
  const tapShape = shapeRR(0.5, 0.17, 0.03, 0.03, 0.3, -1.3);
  const tapGeo = ext(tapShape, 0.05, 0.006, 0.006, 3, 10);
  makeLayer('taptic', 5, tapGeo, g => {
    add(g, tapGeo, MAT.steel(), 0, 0, 0);
    [0.07, 0.53].forEach(x => rbox(g, 0.04, 0.19, 0.064, 0.008, MAT.chip(), x, -1.3, 0));
    box(g, 0.24, 0.004, 0.004, MAT.chip(), 0.3, -1.25, 0.032);
    box(g, 0.24, 0.004, 0.004, MAT.chip(), 0.3, -1.35, 0.032);
    box(g, 0.06, 0.14, 0.003, MAT.flex(), 0.3, -1.16, 0.03);
    // loudspeaker + earpiece
    T(g, 'speaker', () => {
      rbox(g, 0.42, 0.17, 0.05, 0.03, MAT.flex(), -0.33, -1.3, 0);
      for (let i = 0; i < 9; i++) box(g, 0.006, 0.12, 0.004, MAT.black(), -0.49 + i * 0.04, -1.3, 0.027);
      rbox(g, 0.3, 0.07, 0.03, 0.02, MAT.flex(), 0.0, 1.4, 0.05);
      box(g, 0.2, 0.012, 0.004, MAT.shield(), 0.0, 1.4, 0.066);
    });
    // TrueDepth sensor array and front camera
    T(g, 'sensors', () => {
      rbox(g, 0.5, 0.11, 0.02, 0.02, MAT.steel(), 0.0, 1.29, 0.05);
      [[-0.17, 0.028], [-0.08, 0.022], [0.17, 0.024]].forEach(([x, r]) => { rbox(g, 0.075, 0.075, 0.03, 0.012, MAT.black(), x, 1.29, 0.064); cyl(g, r, 0.006, MAT.sensor(), x, 1.29, 0.081, 28); });
      box(g, 0.06, 0.3, 0.003, MAT.flex(), -0.2, 1.1, 0.04);
    });
    T(g, 'frontcam', () => {
      rbox(g, 0.1, 0.1, 0.04, 0.016, MAT.black(), 0.06, 1.29, 0.068);
      cyl(g, 0.036, 0.012, MAT.lensRing(), 0.06, 1.29, 0.09, 32);
      cyl(g, 0.026, 0.006, MAT.coating(), 0.06, 1.29, 0.097, 32);
    });
    // microphones
    T(g, 'mic', () => {
      [[-0.12, -1.42], [0.36, 1.43]].forEach(([x, y]) => { rbox(g, 0.09, 0.06, 0.012, 0.01, MAT.pcb(), x, y, 0.0); cyl(g, 0.018, 0.016, MAT.shield(), x, y, 0.012, 24); });
    });
    // USB-C port and its flex
    T(g, 'charge-flex', () => {
      rbox(g, 0.32, 0.1, 0.012, 0.02, MAT.pcb(), 0.0, -1.4, -0.03);
      const port = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.12, 6, 16), MAT.steel()); port.rotation.z = Math.PI / 2; port.scale.z = 0.55; port.position.set(0, -1.44, 0.0); g.add(port);
      box(g, 0.06, 0.66, 0.003, MAT.flex(), 0.58, -1.05, -0.03);
      box(g, 0.5, 0.05, 0.003, MAT.flex(), 0.36, -1.4, -0.03);
      rbox(g, 0.12, 0.05, 0.01, 0.008, MAT.steel(), 0.58, -0.7, -0.026);
    });
    // side key flexes
    T(g, 'power-flex', () => {
      box(g, 0.035, 0.5, 0.003, MAT.flex(), 0.66, 0.6, 0.0);
      cyl(g, 0.016, 0.01, MAT.steel(), 0.66, 0.6, 0.006, 20);
      cyl(g, 0.016, 0.01, MAT.steel(), 0.66, -0.52, 0.006, 20);
      box(g, 0.035, 0.6, 0.003, MAT.flex(), 0.66, 0.0, 0.0);
    });
    T(g, 'vol-flex', () => {
      box(g, 0.035, 0.84, 0.003, MAT.flex(), -0.66, 0.66, 0.0);
      [1.0, 0.66, 0.34].forEach(y => cyl(g, 0.016, 0.01, MAT.steel(), -0.66, y, 0.006, 20));
      rbox(g, 0.1, 0.05, 0.01, 0.008, MAT.steel(), -0.6, 0.2, 0.004);
    });
    // antenna modules in the corners
    T(g, 'antenna', () => {
      [[-0.46, 1.4, 0.26], [0.46, -1.4, 0.24], [-0.5, -1.38, 0.18], [0.62, 1.0, 0.1]].forEach(([x, y, w]) => {
        rbox(g, w, 0.07, 0.008, 0.02, MAT.antenna(), x, y, -0.03);
        box(g, w * 0.7, 0.012, 0.002, MAT.steel(), x, y, -0.025);
      });
    });
  }, 'taptic');

  /* ===== 6. MagSafe array ===== */
  const MS_Y = -0.42;
  const msGeoEdge = new THREE.RingGeometry(0.44, 0.52, 72); msGeoEdge.translate(0, MS_Y, -0.058);
  makeLayer('magsafe', 6, msGeoEdge, g => {
    const fer = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.006, 72), MAT.ferrite()); fer.rotation.x = Math.PI / 2; fer.position.set(0, MS_Y, -0.062); g.add(fer);
    const cm = MAT.coil();
    for (let r = 0.1; r <= 0.37; r += 0.022) { const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 6, 96), cm); t.position.set(0, MS_Y, -0.056); t.scale.z = 0.5; g.add(t); }
    const mm = MAT.bodyFine();
    const N = 18;
    for (let i = 0; i < N; i++) {
      const a0 = i / N * Math.PI * 2 + 0.03, a1 = (i + 1) / N * Math.PI * 2 - 0.03;
      const s = new THREE.Shape(); s.absarc(0, 0, 0.52, a0, a1, false); s.absarc(0, 0, 0.44, a1, a0, true);
      const m = new THREE.Mesh(ext(s, 0.008, 0.002, 0.002, 2, 6), mm); m.position.set(0, MS_Y, -0.06); g.add(m);
    }
    rbox(g, 0.16, 0.05, 0.014, 0.01, mm, 0, MS_Y - 0.68, -0.06);   // orientation magnet
    box(g, 0.08, 0.34, 0.003, MAT.flex(), 0.18, MS_Y + 0.6, -0.055);
  }, 'coil');

  /* ===== 7. Aluminium unibody ===== */
  const ringShape = shapeRR(CAP_W, CAP_H, CAP_R);
  ringShape.holes.push(shapeRR(CAP_W - 2 * WALL, CAP_H - 2 * WALL, CAP_R - WALL, CAP_R - WALL, 0, 0, THREE.Path));
  const ringGeo = ext(ringShape, D - 2 * BT, BT, BS, 10, 48);
  const WIN = { w: W - 0.2, h: 1.92, cy: -0.44, r: 0.17 };
  const plat = { w: CAP_W - 0.02, h: H / 2 - BS - 0.01 - PLAT_Y0 };
  const platShape = shapeRR(plat.w, plat.h, CAP_R - 0.01, 0.07, 0, PLAT_Y0 + plat.h / 2);
  const PLAT_D = 0.034, PLAT_Z = -D / 2 - PLAT_D;     // outer surface of plateau
  makeLayer('frame', 7, ringGeo, g => {
    const body = MAT.body(), fine = MAT.bodyFine();
    add(g, ringGeo, body);
    // back floor with glass window cutout
    const floor = shapeRR(CAP_W - 2 * WALL, CAP_H - 2 * WALL, CAP_R - WALL);
    floor.holes.push(shapeRR(WIN.w, WIN.h, WIN.r, WIN.r, 0, WIN.cy, THREE.Path));
    const fg = new THREE.ExtrudeGeometry(floor, { depth: 0.016, bevelEnabled: false, curveSegments: 40 });
    photo.push(add(g, backUV(fg), body, 0, 0, -D / 2));
    // camera plateau
    const pg = ext(platShape, PLAT_D - 0.024, 0.012, 0.01, 6, 40);
    photo.push(add(g, backUV(pg), body, 0, 0, -D / 2 - PLAT_D / 2 + 0.002));
    // lens rings + glass
    const up = new THREE.Group(); // helper to build "outward" (-z) features
    const lensAt = (x, y, k) => {
      const grp = new THREE.Group(); grp.position.set(x, y, PLAT_Z + 0.002); grp.rotation.x = -Math.PI / 2;
      const R0 = 0.104, R1 = 0.152;
      const prof = [[R0, 0], [R0, 0.044], [R0 + 0.004, 0.05], [R0 + 0.012, 0.053], [R1 - 0.018, 0.053], [R1 - 0.009, 0.049], [R1 - 0.003, 0.04], [R1 - 0.001, 0.02], [R1, 0]].map(p => new THREE.Vector2(p[0], p[1]));
      const ringM = new THREE.Mesh(new THREE.LatheGeometry(prof, 72), fine); ringM.userData.part = 'lens-rings'; grp.add(ringM);
      grp.userData.part = 'lenses';
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(R0 + 0.001, R0 + 0.001, 0.046, 72), MAT.lensGlass()); cover.position.y = 0.023; grp.add(cover);
      const t1 = new THREE.Mesh(new THREE.TorusGeometry(0.077, 0.004, 8, 72), MAT.lensRing()); t1.rotation.x = Math.PI / 2; t1.position.y = 0.0465; grp.add(t1);
      const coat = new THREE.Mesh(new THREE.CylinderGeometry(k === 'main' ? 0.064 : 0.056, k === 'main' ? 0.064 : 0.056, 0.002, 64), MAT.coating()); coat.position.y = 0.0468; grp.add(coat);
      const t2 = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0025, 8, 48), MAT.lensRing()); t2.rotation.x = Math.PI / 2; t2.position.y = 0.0478; grp.add(t2);
      if (k === 'main') { // six-blade variable aperture
        const blade = new THREE.Shape(); blade.moveTo(0.03, 0); blade.absarc(0, 0, 0.062, 0, Math.PI / 3 + 0.12, false); blade.lineTo(0.03 * Math.cos(Math.PI / 3), 0.03 * Math.sin(Math.PI / 3)); blade.closePath();
        const bg = new THREE.ShapeGeometry(blade, 12); bg.rotateX(-Math.PI / 2);
        const bm = new THREE.MeshStandardMaterial({ color: 0x16171a, metalness: 0.75, roughness: 0.28, side: THREE.DoubleSide });
        for (let b = 0; b < 6; b++) { const m = new THREE.Mesh(bg, bm); m.rotation.y = b * Math.PI / 3; m.position.y = 0.0471 + b * 0.00004; grp.add(m); }
      }
      if (k === 'tele') { const sq = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.001, 0.05), MAT.lensGlass()); sq.position.y = 0.048; grp.add(sq); }
      g.add(grp);
    };
    LENSES.forEach(([x, y, k]) => lensAt(x, y, k));
    const smallAt = (x, y, mat) => {
      const grp = new THREE.Group(); grp.position.set(x, y, PLAT_Z + 0.002); grp.rotation.x = -Math.PI / 2;
      const prof = [[0.05, 0], [0.05, 0.012], [0.054, 0.016], [0.066, 0.016], [0.07, 0.01], [0.071, 0]].map(p => new THREE.Vector2(p[0], p[1]));
      grp.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 48), fine));
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.051, 0.051, 0.012, 48), mat); d.position.y = 0.006; grp.add(d);
      g.add(grp); return grp;
    };
    const fl = smallAt(-0.448, 1.236, MAT.flash()); fl.userData.part = 'flash';
    const ft = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.002, 6, 40), new THREE.MeshStandardMaterial({ color: 0xbdbab2, roughness: 0.6 })); ft.rotation.x = Math.PI / 2; ft.position.y = 0.0125; fl.add(ft);
    smallAt(-0.444, 0.82, MAT.lensGlass()).userData.part = 'sensors';
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.002, 20), MAT.black()); mic.rotation.x = Math.PI / 2; mic.position.set(-0.447, 1.03, PLAT_Z - 0.0002); g.add(mic);

    // buttons
    const btn = (side, y, len, mat = fine, r = 0.022, sx = 0.5) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - 2 * r, 6, 20), mat); m.scale.set(sx, 1, 1.15);
      m.position.set(side * (W / 2 - 0.004), y, 0); g.add(m); return m;
    };
    btn(-1, 1.0, 0.14); btn(-1, 0.66, 0.26); btn(-1, 0.34, 0.26); btn(1, 0.6, 0.38);
    const cc = btn(1, -0.52, 0.36, new THREE.MeshPhysicalMaterial({ color: 0x141518, roughness: 0.12, metalness: 0.3, clearcoat: 1 }), 0.02, 0.26);
    cc.position.x = W / 2 - 0.0005;
    // antenna bands
    const bandM = MAT.band(), prof = sideProfile(0.014);
    [[1, 1.18], [1, -1.16], [-1, 1.22], [-1, -1.2]].forEach(([s, y]) => { const m = new THREE.Mesh(prof, bandM); m.position.y = y; if (s < 0) m.rotation.y = Math.PI; g.add(m); });
    const profTB = sideProfile(0.014);
    [[1, -0.36], [1, 0.36], [-1, -0.42], [-1, 0.42]].forEach(([s, x]) => { const m = new THREE.Mesh(profTB, bandM); m.rotation.z = s > 0 ? Math.PI / 2 : -Math.PI / 2; m.position.x = x; g.add(m); });
    // bottom: USB-C, speaker + mic holes, screws
    const bottom = (geo, mat, x) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = Math.PI / 2; m.position.set(x, -H / 2 - 0.0007, 0); g.add(m); return m; };
    const usb = new THREE.Shape(); usb.absarc(-0.06, 0, 0.026, Math.PI / 2, Math.PI * 1.5, false); usb.absarc(0.06, 0, 0.026, -Math.PI / 2, Math.PI / 2, false);
    bottom(new THREE.ShapeGeometry(usb, 16), MAT.black(), 0);
    const hole = new THREE.CircleGeometry(0.0105, 18), hm = MAT.black();
    for (let i = 0; i < 6; i++) { bottom(hole, hm, 0.2 + i * 0.04); bottom(hole, hm, -0.2 - i * 0.04); }
    const screw = new THREE.CircleGeometry(0.009, 16), sm = MAT.steel();
    bottom(screw, sm, 0.13).userData.part = 'screws'; bottom(screw, sm, -0.13).userData.part = 'screws';
    // SIM tray, left side under the volume keys
    T(g, 'sim', () => {
      const tray = new THREE.Group(); tray.position.set(-W / 2 + 0.002, -0.2, 0);
      const face = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.3, 6, 24), fine); face.scale.set(0.24, 1, 1); tray.add(face);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 16), MAT.black()); pin.rotation.z = Math.PI / 2; pin.position.set(-0.007, -0.13, 0); tray.add(pin);
      const bed = new THREE.Mesh(ext(shapeRR(0.3, 0.17, 0.02), 0.012), MAT.steel()); bed.rotation.y = Math.PI / 2; bed.rotation.z = Math.PI / 2; bed.position.set(0.155, 0, 0); tray.add(bed);
      const card = new THREE.Mesh(ext(shapeRR(0.24, 0.12, 0.015), 0.004), MAT.chip()); card.rotation.y = Math.PI / 2; card.rotation.z = Math.PI / 2; card.position.set(0.155, 0.0, 0.009); tray.add(card);
      g.add(tray);
    });
  }, 'frame');

  /* ===== 8. Ceramic Shield back glass ===== */
  const winShape = shapeRR(WIN.w - 0.008, WIN.h - 0.008, WIN.r - 0.004, WIN.r - 0.004, 0, WIN.cy);
  const winGeo = ext(winShape, 0.01, 0.003, 0.003, 3, 40);
  makeLayer('back', 8, winGeo, g => {
    photo.push(add(g, backUV(winGeo.clone()), MAT.glassBack(), 0, 0, -D / 2 + 0.006));
    const logo = new THREE.Mesh(appleLogoGeometry(0.31), MAT.logo());
    logo.rotation.y = Math.PI; logo.position.set(0, MS_Y + 0.02, -D / 2 - 0.0036); logo.renderOrder = 2; g.add(logo); photoLogo = logo;
  }, 'rear-glass');

  /* ===== 2b. Shielding, brackets and fasteners (between display and board) ===== */
  const shieldEdge = shapeRR(0.56, 1.2, 0.03, 0.03, -0.33, 0.8);
  makeLayer('shields', 1, ext(shieldEdge, 0.002), g => {
    const Z = 0.068;
    T(g, 'thermal', () => {
      rbox(g, 0.56, 1.2, 0.003, 0.03, MAT.graphite(), -0.33, 0.8, Z - 0.004, 0.001);
      rbox(g, 0.42, 0.3, 0.003, 0.03, MAT.graphite(), 0.3, 0.42, Z - 0.004, 0.001);
    });
    T(g, 'emi', () => {
      rbox(g, 0.4, 0.36, 0.002, 0.03, MAT.emi(), -0.33, 1.06, Z, 0.0008);
      rbox(g, 0.3, 0.2, 0.002, 0.02, MAT.emi(), 0.3, 0.42, Z, 0.0008);
      rbox(g, 0.22, 0.12, 0.002, 0.02, MAT.emi(), -0.37, 0.62, Z, 0.0008);
    });
    T(g, 'brackets', () => {
      [[-0.18, 1.3, 0.22], [-0.47, 0.88, 0.2], [0.06, 0.52, 0.22], [0.48, 0.56, 0.16]].forEach(([x, y, w]) => rbox(g, w, 0.1, 0.006, 0.015, MAT.steel(), x, y, Z + 0.004, 0.0015));
    });
    T(g, 'plates', () => {
      rbox(g, 1.12, 0.3, 0.005, 0.04, MAT.shield(), 0.0, -1.27, Z - 0.03, 0.0015);
      rbox(g, 0.84, 0.1, 0.005, 0.03, MAT.shield(), 0.06, 1.42, Z - 0.006, 0.0015);
    });
    T(g, 'clips', () => {
      [[-0.18, 1.3], [-0.47, 0.88], [0.06, 0.52], [0.48, 0.56]].forEach(([x, y]) => { box(g, 0.012, 0.11, 0.012, MAT.steel(), x - 0.05, y, Z + 0.006); box(g, 0.012, 0.11, 0.012, MAT.steel(), x + 0.05, y, Z + 0.006); });
    });
    T(g, 'screws', () => {
      [[-0.29, 1.3], [-0.07, 1.3], [-0.57, 0.88], [-0.37, 0.88], [-0.05, 0.52], [0.17, 0.52], [0.4, 0.56], [0.56, 0.56], [-0.5, -1.27], [0.5, -1.27], [-0.3, 1.42], [0.42, 1.42]].forEach(([x, y]) => screwAt(g, x, y, Z + (y < -1 ? -0.024 : 0.009)));
    });
    T(g, 'fasteners', () => {
      [[-0.57, 0.24], [0.57, 0.24], [-0.57, 1.34], [-0.1, 1.34], [0.57, 0.6]].forEach(([x, y]) => { const n = cyl(g, 0.017, 0.022, MAT.steel(), x, y, Z - 0.012, 6); cyl(g, 0.007, 0.024, MAT.chip(), x, y, Z - 0.011, 16); });
    });
  }, 'brackets');

  const order = ['oled', 'frame', 'shields', 'board', 'camera', 'battery', 'taptic', 'magsafe', 'back'];
  layers.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  layers.forEach((L, i) => { L.index = i; });
  // swap in the official back photo once it arrives; procedural finish stays as the fallback
  if (opts.photo !== false) backPhoto().then(tex => {
    photo.forEach(m => {
      const base = m.material;
      const pm = new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, metalness: 0.12, roughness: 0.66, roughnessMap: grain(), envMapIntensity: 0.45 });
      m.material = [pm, base];   // extrude groups: 0 caps (photo), 1 sides (metal)
      const L = layers.find(l => l.group === m.parent || l.group.children.includes(m));
      if (L) { L.mats.push(pm); pm.transparent = base.transparent; pm.opacity = base.opacity; }
    });
    if (photoLogo) photoLogo.visible = false;
    root.userData.photo = true;
    opts.onPhoto?.();
  }).catch(() => {});
  return { root, layers, textTex, dims: { W, H, D, LENSES, PLAT_Z } };
}
