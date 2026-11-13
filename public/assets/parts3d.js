import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPhone, grain } from './phone-model.js';

/*
  Live 360 catalogue. Each part is isolated from the same handset model used in the hero
  (every mesh carries a catalogue tag) or built as loose studio hardware, then turned on a
  turntable. One shared WebGL context renders only the cards on screen and copies each frame
  into the card's own 2D canvas. Drag sideways to turn, gyro adds a little sway.
*/
const M = {
  steel: () => new THREE.MeshStandardMaterial({ color: 0xb9bbbe, metalness: 1, roughness: 0.46, roughnessMap: grain() }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0.25, roughness: 0.58 }),
  pcb: () => new THREE.MeshStandardMaterial({ color: 0x141516, metalness: 0.25, roughness: 0.66 }),
  shield: () => new THREE.MeshStandardMaterial({ color: 0x9a9ca0, metalness: 0.9, roughness: 0.56, roughnessMap: grain() }),
  ant: () => new THREE.MeshStandardMaterial({ color: 0x3a3b3e, metalness: 0.4, roughness: 0.5 }),
  flex: () => new THREE.MeshStandardMaterial({ color: 0x1e1f21, metalness: 0.2, roughness: 0.55 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x0c0d0f, metalness: 0.1, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.35 }),
  oca: () => new THREE.MeshStandardMaterial({ color: 0xe4eaee, metalness: 0, roughness: 0.3, transparent: true, opacity: 0.5 }),
  alu: () => new THREE.MeshStandardMaterial({ color: 0x8c8f93, metalness: 1, roughness: 0.48, roughnessMap: grain() }),
  gold: () => new THREE.MeshStandardMaterial({ color: 0xc2a062, metalness: 1, roughness: 0.42 }),
  copper: () => new THREE.MeshStandardMaterial({ color: 0xb07454, metalness: 1, roughness: 0.5, roughnessMap: grain() }),
  foam: () => new THREE.MeshStandardMaterial({ color: 0x161617, metalness: 0, roughness: 0.9 })
};
function ringShape(w, h, r, t) {
  const s = rr(w, h, r); s.holes.push(rr(w - t * 2, h - t * 2, Math.max(0.005, r - t))); return s;
}
function ring(w, h, r, t, d, mat, x = 0, y = 0, z = 0) {
  const g = new THREE.ExtrudeGeometry(ringShape(w, h, r, t), { depth: d, bevelEnabled: false, curveSegments: 14 });
  g.translate(0, 0, -d / 2); const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); return m;
}
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
function rr(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
function slab(w, h, d, r, mat, x = 0, y = 0, z = 0) {
  const g = new THREE.ExtrudeGeometry(rr(w, h, r), { depth: d, bevelEnabled: true, bevelThickness: Math.min(0.006, d / 4), bevelSize: Math.min(0.006, r / 2), bevelSegments: 3, curveSegments: 12 });
  g.translate(0, 0, -d / 2); const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); return m;
}
const cyl = (r, h, mat, seg = 32) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); m.rotation.x = Math.PI / 2; return m; };
function screw(kind) {
  const g = new THREE.Group(), st = M.steel(), dk = M.dark();
  const head = cyl(0.07, 0.04, st, 32); head.position.z = 0.0; g.add(head);
  const shaft = cyl(0.034, 0.26, st, 20); shaft.position.z = -0.15; g.add(shaft);
  for (let i = 0; i < 9; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.007, 6, 20), st); t.position.z = -0.06 - i * 0.026; g.add(t); }
  const n = kind === 'penta' ? 5 : kind === 'tri' ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(kind === 'ph' ? 0.09 : 0.05, 0.016, 0.01), dk);
    b.rotation.z = i * Math.PI / n + (kind === 'ph' ? 0 : Math.PI / 2); if (kind !== 'ph') b.geometry.translate(0.022, 0, 0);
    b.position.z = 0.02; g.add(b);
  }
  return g;
}
const LOOSE = {
  screws() {
    const g = new THREE.Group();
    ['penta', 'tri', 'ph', 'penta', 'tri', 'ph'].forEach((k, i) => { const s = screw(k); s.position.set((i % 3 - 1) * 0.26, (i < 3 ? 0.15 : -0.15), 0); s.rotation.x = 0.0; g.add(s); });
    return g;
  },
  fasteners() {
    const g = new THREE.Group(), st = M.steel(), dk = M.dark();
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Group(); p.position.set((i % 3 - 1) * 0.26, i < 3 ? 0.14 : -0.14, 0);
      const hex = cyl(0.06, 0.1, st, 6); p.add(hex);
      const hole = cyl(0.026, 0.104, dk, 20); p.add(hole);
      if (i % 2) { const base = cyl(0.08, 0.02, st, 32); base.position.z = -0.06; p.add(base); }
      g.add(p);
    }
    return g;
  },
  clips() {
    const g = new THREE.Group(), st = M.steel();
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Group(); c.position.set((i % 2 - 0.5) * 0.42, i < 2 ? 0.14 : -0.14, 0);
      c.add(slab(0.32, 0.12, 0.012, 0.02, st));
      [-1, 1].forEach(s => { const lip = slab(0.32, 0.03, 0.05, 0.008, st, 0, s * 0.06, -0.025); c.add(lip); });
      const tab = slab(0.06, 0.04, 0.012, 0.01, st, 0.18, 0, 0); c.add(tab);
      g.add(c);
    }
    return g;
  },
  mic() {
    const g = new THREE.Group();
    [[-0.22, 0.32], [0.22, 0.24]].forEach(([x, w]) => {
      g.add(slab(w, 0.2, 0.03, 0.03, M.pcb(), x, 0, 0));
      const can = cyl(0.06, 0.05, M.shield(), 32); can.position.set(x, 0.02, 0.04); g.add(can);
      const port = cyl(0.014, 0.052, M.dark(), 16); port.position.set(x, 0.02, 0.042); g.add(port);
      g.add(slab(0.06, 0.34, 0.006, 0.01, M.flex(), x, -0.24, 0));
    });
    return g;
  },
  antenna() {
    const g = new THREE.Group();
    [[0.7, 0.24], [0.56, 0.0], [0.42, -0.24]].forEach(([w, y], i) => {
      g.add(slab(w, 0.13, 0.02, 0.04, M.ant(), 0, y, 0));
      g.add(slab(w * 0.72, 0.026, 0.006, 0.01, M.steel(), 0, y, 0.014));
      const pad = cyl(0.026, 0.02, M.steel(), 24); pad.position.set(w / 2 - 0.07, y, 0.016); g.add(pad);
    });
    return g;
  },
  plates() {
    const g = new THREE.Group(), sh = M.shield();
    const a = slab(1.1, 0.3, 0.012, 0.04, sh, 0, 0.12, 0); g.add(a);
    const b = slab(0.84, 0.12, 0.012, 0.03, sh, 0.1, -0.2, 0); g.add(b);
    [[-0.5, 0.12], [0.5, 0.12], [-0.28, -0.2], [0.48, -0.2]].forEach(([x, y]) => { const h = cyl(0.022, 0.016, M.dark(), 20); h.position.set(x, y, 0.002); g.add(h); });
    return g;
  },
  speaker() {
    const g = new THREE.Group();
    g.add(slab(0.78, 0.26, 0.09, 0.05, M.dark(), 0, 0.1, 0));
    for (let i = 0; i < 16; i++) { const h = cyl(0.011, 0.094, M.steel(), 10); h.position.set(-0.3 + (i % 8) * 0.085, 0.1 + (i < 8 ? 0.04 : -0.04), 0.002); g.add(h); }
    g.add(slab(0.2, 0.12, 0.012, 0.02, M.shield(), 0.24, 0.1, 0.052));
    g.add(slab(0.4, 0.1, 0.05, 0.04, M.dark(), -0.12, -0.2, 0));
    g.add(slab(0.3, 0.02, 0.054, 0.01, M.steel(), -0.12, -0.2, 0));
    g.add(slab(0.05, 0.22, 0.006, 0.01, M.flex(), 0.14, -0.26, 0));
    return g;
  },
  'power-flex'() { return keyFlex(1); },
  'vol-flex'() { return keyFlex(3); },
  sim() {
    const g = new THREE.Group(), al = M.alu();
    g.add(slab(0.9, 0.17, 0.03, 0.085, al));
    const bed = slab(0.58, 0.13, 0.008, 0.03, M.dark(), -0.06, 0, 0.018); g.add(bed);
    const cap = slab(0.06, 0.2, 0.05, 0.03, al, 0.47, 0, 0); g.add(cap);
    const hole = cyl(0.014, 0.052, M.dark(), 16); hole.position.set(0.47, 0.05, 0.002); g.add(hole);
    const seal = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.15, 0.022), M.dark()); seal.position.set(0.43, 0, 0); g.add(seal);
    return g;
  }
};
function keyFlex(n) {
  const g = new THREE.Group();
  g.add(slab(0.08, 0.86, 0.006, 0.02, M.flex(), 0, 0, 0));
  for (let i = 0; i < n; i++) {
    const y = 0.3 - i * (n > 1 ? 0.24 : 0);
    g.add(slab(0.16, 0.13, 0.016, 0.02, M.flex(), 0, y, 0.004));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.steel()); dome.rotation.x = Math.PI / 2; dome.scale.z = 0.4; dome.position.set(0, y, 0.012); g.add(dome);
  }
  const conn = slab(0.2, 0.08, 0.03, 0.01, M.dark(), 0.05, -0.44, 0.01); g.add(conn);
  const stiff = slab(0.22, 0.1, 0.008, 0.01, M.steel(), 0.05, -0.44, -0.012); g.add(stiff);
  return g;
}


Object.assign(LOOSE, {
  'touch-glass'() {
    const g = new THREE.Group();
    g.add(slab(0.72, 1.5, 0.02, 0.12, M.glass()));
    g.add(slab(0.68, 1.46, 0.008, 0.1, M.oca(), 0, 0, -0.016));
    g.add(slab(0.16, 0.035, 0.022, 0.017, M.foam(), 0, 0.66, 0.002));
    return g;
  },
  lcd() {
    const g = new THREE.Group();
    g.add(slab(0.72, 1.5, 0.03, 0.1, M.glass()));
    g.add(slab(0.7, 1.4, 0.03, 0.08, M.shield(), 0, 0.02, -0.03));
    g.add(slab(0.26, 0.34, 0.006, 0.02, M.flex(), 0, -0.86, -0.036));
    g.add(slab(0.18, 0.08, 0.03, 0.01, M.dark(), 0, -0.98, -0.03));
    g.add(slab(0.2, 0.1, 0.008, 0.01, M.steel(), 0, -0.98, -0.05));
    return g;
  },
  keys() {
    const g = new THREE.Group(), a = M.alu();
    [[-0.3, 0.3], [-0.12, 0.22], [0.06, 0.22], [0.24, 0.42]].forEach(([x, l]) => {
      g.add(slab(0.09, l, 0.05, 0.044, a, x, 0.05, 0));
      g.add(slab(0.05, l * 0.6, 0.03, 0.02, M.dark(), x, 0.05, -0.04));
    });
    return g;
  },
  'cam-control'() {
    const g = new THREE.Group();
    g.add(slab(0.16, 0.42, 0.03, 0.07, M.steel(), 0, 0.12, -0.02));
    g.add(slab(0.12, 0.38, 0.04, 0.055, M.glass(), 0, 0.12, 0.01));
    g.add(slab(0.06, 0.5, 0.006, 0.02, M.flex(), 0.08, -0.26, -0.03));
    g.add(slab(0.16, 0.08, 0.03, 0.01, M.dark(), 0.08, -0.52, -0.02));
    return g;
  },
  'usb-port'() {
    const g = new THREE.Group();
    g.add(slab(0.4, 0.13, 0.12, 0.065, M.steel()));
    g.add(slab(0.3, 0.06, 0.124, 0.03, M.dark()));
    g.add(slab(0.2, 0.018, 0.13, 0.008, M.gold()));
    [-1, 1].forEach(s => { g.add(slab(0.12, 0.1, 0.014, 0.03, M.steel(), s * 0.27, -0.02, -0.04)); const h = cyl(0.022, 0.016, M.dark(), 20); h.position.set(s * 0.29, -0.02, -0.036); g.add(h); });
    return g;
  },
  'main-flex'() {
    const g = new THREE.Group();
    g.add(slab(0.1, 1.2, 0.006, 0.02, M.flex()));
    [0.62, -0.62].forEach(y => { g.add(slab(0.22, 0.09, 0.03, 0.012, M.dark(), 0, y, 0.012)); g.add(slab(0.24, 0.11, 0.008, 0.012, M.steel(), 0, y, -0.008)); });
    g.add(slab(0.14, 0.16, 0.008, 0.02, M.ant(), 0, 0.1, 0.004));
    return g;
  },
  'sim-reader'() {
    const g = new THREE.Group();
    g.add(slab(0.5, 0.36, 0.03, 0.03, M.pcb()));
    g.add(ring(0.46, 0.32, 0.02, 0.025, 0.04, M.steel(), 0, 0, 0.02));
    for (let i = 0; i < 6; i++) g.add(slab(0.05, 0.1, 0.01, 0.006, M.gold(), -0.13 + (i % 3) * 0.13, i < 3 ? 0.07 : -0.07, 0.02));
    g.add(slab(0.08, 0.3, 0.006, 0.02, M.flex(), 0.18, -0.3, 0));
    return g;
  },
  'sub-board'() {
    const g = new THREE.Group();
    g.add(slab(0.8, 0.4, 0.03, 0.04, M.pcb()));
    g.add(at(slab(0.3, 0.1, 0.1, 0.05, M.steel()), 0, -0.13, 0.05));
    const can = cyl(0.05, 0.05, M.shield(), 28); can.position.set(-0.28, 0.08, 0.04); g.add(can);
    g.add(slab(0.18, 0.12, 0.03, 0.01, M.shield(), 0.22, 0.08, 0.03));
    g.add(slab(0.14, 0.08, 0.03, 0.01, M.dark(), -0.02, 0.1, 0.03));
    g.add(slab(0.08, 0.4, 0.006, 0.02, M.flex(), 0.3, 0.36, 0));
    return g;
  },
  earpiece() {
    const g = new THREE.Group();
    g.add(slab(0.56, 0.14, 0.07, 0.07, M.dark()));
    g.add(slab(0.4, 0.05, 0.074, 0.025, M.steel(), 0, 0.01, 0.002));
    for (let i = 0; i < 12; i++) { const h = cyl(0.007, 0.08, M.dark(), 8); h.position.set(-0.17 + i * 0.031, 0.01, 0.004); g.add(h); }
    g.add(slab(0.05, 0.3, 0.006, 0.01, M.flex(), 0.2, -0.2, -0.02));
    return g;
  },
  faceid() {
    const g = new THREE.Group();
    g.add(slab(0.7, 0.16, 0.05, 0.05, M.steel()));
    [[-0.24, 0.05], [-0.04, 0.035], [0.22, 0.055]].forEach(([x, r]) => { const c = cyl(r + 0.012, 0.07, M.dark(), 32); c.position.set(x, 0, 0.02); g.add(c); const l = cyl(r, 0.074, M.glass(), 32); l.position.set(x, 0, 0.022); g.add(l); });
    g.add(slab(0.1, 0.4, 0.006, 0.02, M.flex(), 0.06, -0.27, -0.02));
    g.add(slab(0.2, 0.08, 0.03, 0.01, M.dark(), 0.06, -0.48, -0.01));
    return g;
  },
  fingerprint() {
    const g = new THREE.Group();
    const r = cyl(0.17, 0.05, M.steel(), 48); g.add(r);
    const d = cyl(0.15, 0.056, M.glass(), 48); g.add(d);
    g.add(slab(0.08, 0.46, 0.006, 0.02, M.flex(), 0, -0.36, -0.02));
    g.add(slab(0.18, 0.08, 0.03, 0.01, M.dark(), 0, -0.6, -0.01));
    return g;
  },
  proximity() {
    const g = new THREE.Group();
    g.add(slab(0.09, 0.9, 0.006, 0.02, M.flex()));
    g.add(slab(0.16, 0.1, 0.04, 0.02, M.dark(), 0, 0.4, 0.02));
    [-0.035, 0.035].forEach(x => { const w = cyl(0.016, 0.044, M.glass(), 20); w.position.set(x, 0.4, 0.024); g.add(w); });
    g.add(slab(0.18, 0.08, 0.03, 0.01, M.dark(), 0, -0.45, 0.01));
    return g;
  },
  jack() {
    const g = new THREE.Group();
    g.add(slab(0.3, 0.18, 0.14, 0.03, M.dark()));
    const c = cyl(0.06, 0.04, M.steel(), 32); c.rotation.set(0, Math.PI / 2, 0); c.position.set(-0.17, 0, 0); g.add(c);
    const h = cyl(0.035, 0.044, M.foam(), 24); h.rotation.set(0, Math.PI / 2, 0); h.position.set(-0.175, 0, 0); g.add(h);
    g.add(slab(0.08, 0.4, 0.006, 0.02, M.flex(), 0.08, -0.28, -0.06));
    return g;
  },
  nfc() {
    const g = new THREE.Group();
    g.add(slab(0.7, 0.86, 0.006, 0.08, M.flex()));
    for (let i = 0; i < 6; i++) g.add(ring(0.62 - i * 0.07, 0.78 - i * 0.07, 0.07, 0.014, 0.004, M.copper(), 0, 0, 0.005));
    g.add(slab(0.08, 0.3, 0.006, 0.02, M.flex(), 0.2, -0.56, 0));
    return g;
  },
  vapour() {
    const g = new THREE.Group(), cu = M.copper();
    g.add(slab(0.6, 1.0, 0.02, 0.06, cu));
    g.add(slab(0.4, 0.5, 0.012, 0.04, cu, 0, 0.16, 0.012));
    for (let i = 0; i < 4; i++) { const d = cyl(0.03, 0.026, M.dark(), 24); d.position.set(i % 2 ? 0.22 : -0.22, i < 2 ? 0.42 : -0.42, 0); g.add(d); }
    return g;
  },
  adhesive() {
    const g = new THREE.Group(), f = M.foam();
    g.add(ring(0.74, 1.52, 0.12, 0.03, 0.006, f, 0, 0, 0));
    g.add(ring(0.6, 1.3, 0.1, 0.05, 0.006, new THREE.MeshStandardMaterial({ color: 0xe9e9e9, roughness: 0.5, transparent: true, opacity: 0.75 }), 0, 0, -0.06));
    return g;
  }
});

/* catalogue id -> model tags (assemblies use several) */
const SPEC = {
  'display-asm': ['display', 'disp-conn', 'frame'],
  'back-housing': ['frame', 'rear-glass', 'lens-rings', 'lenses', 'flash', 'sim'],
  'camera-module': ['camera-module', 'lenses', 'lens-rings', 'sensor-asm', 'flash', 'sensors']
};
const BACKS = new Set(['rear-glass', 'frame', 'camera-module', 'lenses', 'lens-rings', 'flash', 'coil', 'back-housing', 'cam-housing', 'sensor-asm']);

const mobile = matchMedia('(pointer:coarse)').matches || innerWidth < 760;
let renderer, scene, cam, meshes = [], ready = false;
const objs = {};
const cards = new Map();   // canvas -> state
let sheetState = null, raf = 0, last = 0, scrollA = 0;
const gyro = { x: 0, y: 0, tx: 0, ty: 0, live: false };

function setup() {
  const cv = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setClearColor(0, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.7;
  const k = new THREE.DirectionalLight(0xffffff, 1.9); k.position.set(-3, 6, 6); scene.add(k);
  const r2 = new THREE.DirectionalLight(0xffffff, 0.8); r2.position.set(5, 2, -4); scene.add(r2);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d8d8, 0.35));
  cam = new THREE.PerspectiveCamera(22, 1, 0.05, 100);
  const { root, layers } = buildPhone({ onPhoto: () => { for (const k in objs) if (!LOOSE[k]) delete objs[k]; } });
  layers.forEach(L => { L.edges.visible = false; L.group.position.set(0, 0, 0); });
  root.updateMatrixWorld(true);
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
}

/* build (once) a turntable rig: spin(Y) > orient > centred part */
function rig(id) {
  if (objs[id] !== undefined) return objs[id];
  let part;
  if (LOOSE[id]) part = LOOSE[id]();
  else {
    const tags = SPEC[id] || [id];
    part = new THREE.Group();
    meshes.forEach(m => { if (!tags.includes(m.userData.part)) return; const c = m.clone(false); c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); part.add(c); });
    if (!part.children.length) return (objs[id] = null);
  }
  part.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(part);
  const ctr = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const centred = new THREE.Group(); centred.add(part); part.position.sub(ctr);
  const orient = new THREE.Group(); orient.add(centred);
  orient.rotation.set(-0.22, BACKS.has(id) ? Math.PI : 0, 0);
  const spin = new THREE.Group(); spin.add(orient);
  const r = sz.length() / 2;
  return (objs[id] = { spin, r });
}

function draw(st, w) {
  const o = rig(st.id); if (!o) return false;
  if (renderer.domElement.width !== w) renderer.setSize(w, w, false);
  o.spin.rotation.y = st.a + gyro.y + (st.scroll ? scrollA : 0);
  o.spin.rotation.x = gyro.x * 0.6;
  scene.add(o.spin);
  const d = o.r / Math.sin(THREE.MathUtils.degToRad(cam.fov) / 2) / 0.94, el = 0.3;
  cam.position.set(0, Math.sin(el) * d, Math.cos(el) * d); cam.near = d / 40; cam.far = d * 4; cam.updateProjectionMatrix(); cam.lookAt(0, 0, 0);
  renderer.render(scene, cam);
  scene.remove(o.spin);
  const c = st.ctx; c.clearRect(0, 0, w, w);
  // soft studio contact shadow
  const g = c.createRadialGradient(w / 2, w * 0.9, 0, w / 2, w * 0.9, w * 0.36);
  g.addColorStop(0, 'rgba(8,8,8,0.16)'); g.addColorStop(1, 'rgba(8,8,8,0)');
  c.save(); c.translate(0, w * 0.9); c.scale(1, 0.16); c.translate(0, -w * 0.9); c.fillStyle = g; c.fillRect(0, 0, w, w * 2); c.restore();
  c.drawImage(renderer.domElement, 0, 0, w, w);
  return true;
}

function drag(el, st, opts = {}) {
  let x0 = 0, y0 = 0, a0 = 0, on = false, moved = false, id = null;
  el.addEventListener('pointerdown', e => { on = true; moved = false; id = e.pointerId; x0 = e.clientX; y0 = e.clientY; a0 = st.a; st.hold = true; });
  el.addEventListener('pointermove', e => {
    if (!on || e.pointerId !== id) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (!moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) { moved = true; try { el.setPointerCapture(id); } catch (_) {} }
    if (moved) { st.a = a0 + dx * 0.012; st.dirty = true; }
  });
  const end = () => { if (!on) return; on = false; st.hold = false; if (moved && opts.card) { opts.card.dataset.drag = '1'; setTimeout(() => { opts.card.dataset.drag = ''; }, 400); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
}

let rr0 = 0;
function loop(t) {
  raf = requestAnimationFrame(loop);
  const step = mobile ? 33 : 16;
  if (t - last < step) return;
  last = t;
  if (document.hidden) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now(), budget = mobile ? 10 : 12;
  gyro.x += (gyro.tx - gyro.x) * 0.12; gyro.y += (gyro.ty - gyro.y) * 0.12;
  if (sheetState) {   // sheet open: only the sheet turns, the grid behind it rests
    const dt = Math.min(0.1, (t - (sheetState.t || t)) / 1000); sheetState.t = t;
    if (!sheetState.hold && !reduce) sheetState.a += dt * 0.5;
    draw(sheetState, sheetState.px); return;
  }
  const vis = []; for (const [cv, st] of cards) if (st.vis) vis.push([cv, st]);
  if (!vis.length) return;
  // round-robin under a time budget so slow GPUs never starve the page
  for (let n = 0; n < vis.length; n++) {
    const [cv, st] = vis[(rr0 + n) % vis.length];
    const dt = Math.min(0.15, (t - (st.t || t)) / 1000); st.t = t;
    if (!st.hold && !reduce) st.a += dt * 0.55;
    if (draw(st, st.px) && !st.done) { st.done = true; cv.closest('.part')?.classList.add('has-art'); }
    if (performance.now() - t0 > budget) { rr0 = (rr0 + n + 1) % vis.length; return; }
  }
}

async function init() {
  setup();
  if (document.fonts) await document.fonts.ready.catch(() => {});
  const px = Math.round(Math.min(mobile ? 340 : 400, 200 * Math.min(2, devicePixelRatio || 1)));
  const io = new IntersectionObserver(es => es.forEach(e => { const st = cards.get(e.target); if (st) st.vis = e.isIntersecting; }), { rootMargin: '80px 0px' });
  document.querySelectorAll('.p-art[data-art]').forEach((box, i) => {
    const id = box.dataset.art;
    const cv = document.createElement('canvas'); cv.className = 'p-cv'; cv.width = cv.height = px; cv.setAttribute('aria-hidden', 'true');
    box.prepend(cv);
    const st = { id, a: -0.5 + (i % 5) * 0.55, ctx: cv.getContext('2d'), px, vis: false, done: false };
    st.scroll = true; cards.set(cv, st); io.observe(cv);
  });
  // gyroscope steers the turntable: tilt left/right turns the part, forward/back tips it
  let b0 = null;
  addEventListener('deviceorientation', e => {
    if (e.gamma == null) return;
    gyro.live = true; if (b0 == null) b0 = e.beta;
    gyro.ty = Math.max(-1, Math.min(1, e.gamma / 40)) * 1.6;
    gyro.tx = Math.max(-1, Math.min(1, (e.beta - b0) / 40)) * 0.45;
  });
  // swiping the carousel turns every part with it
  const rail = document.querySelector('#partsGrid');
  if (rail) rail.addEventListener('scroll', () => { scrollA = rail.scrollLeft * 0.006; }, { passive: true });
  ready = true;
  if (pending) api.sheet(...pending);
  window.__partsArt = { cards: cards.size, ids: [...new Set([...cards.values()].map(s => s.id))] };
  document.dispatchEvent(new CustomEvent('parts-art'));
  requestAnimationFrame(loop);
}

let pending = null;
const sheetDrag = new WeakSet();
const api = {
  sheet(id, cv) {
    if (!cv) return;
    if (!ready) { pending = [id, cv]; return; }
    pending = null;
    const px = Math.round(Math.min(480, (cv.clientWidth || 200) * Math.min(2, devicePixelRatio || 1)));
    cv.width = cv.height = px;
    const st = { id, a: -0.6, ctx: cv.getContext('2d'), px, hold: false };
    sheetState = st;
    if (!sheetDrag.has(cv)) { sheetDrag.add(cv); drag(cv, { get a() { return sheetState ? sheetState.a : 0; }, set a(v) { if (sheetState) sheetState.a = v; }, set hold(v) { if (sheetState) sheetState.hold = v; }, set dirty(v) {} }); }
    draw(st, px);
  },
  stopSheet() { pending = null; sheetState = null; },
  rendered: () => [...cards.values()].filter(s => s.done).length
};
window.ADP3D = api;
const go = () => init().catch(e => console.warn('parts render', e));
if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 2000 }); else setTimeout(go, 700);
