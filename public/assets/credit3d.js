import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { grain } from './phone-model.js';
import { FONT } from './credit-font.js';

/*
  Developer credit, cast in matte black metal.
  Real Clash Display outlines extruded with a chamfer, letters rise one by one as the
  page reaches its end, a light sweeps across once the visitor hits the very bottom,
  and the word follows the gyroscope (or the mouse on desktop).
*/
const host = document.getElementById('dc3d');
if (host) {
  const mobile = matchMedia('(pointer:coarse)').matches || innerWidth < 760;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { init(); } catch (e) { console.warn('credit 3d', e); }

  function glyphShapes(ch) {
    const g = FONT.g[ch]; if (!g) return [];
    const sp = new THREE.ShapePath();
    for (const c of g.c) {
      let i = 0;
      while (i < c.length) {
        const k = c[i++];
        if (k === 'm') sp.moveTo(c[i++], c[i++]);
        else if (k === 'l') sp.lineTo(c[i++], c[i++]);
        else if (k === 'q') { const a = c[i++], b = c[i++]; sp.quadraticCurveTo(a, b, c[i++], c[i++]); }
        else if (k === 'c') { const a = c[i++], b = c[i++], d = c[i++], e = c[i++]; sp.bezierCurveTo(a, b, d, e, c[i++], c[i++]); }
      }
    }
    return sp.toShapes(false);
  }

  function init() {
    const canvas = host.querySelector('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setClearColor(0, 0);
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.75;
    const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(-2, 3, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(3, -1, -3); scene.add(rim);
    const sweep = new THREE.PointLight(0xffffff, 0, 6, 1.6); scene.add(sweep);
    const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);

    const face = new THREE.MeshPhysicalMaterial({ color: 0x0d0d0e, metalness: 0.62, roughness: 0.46, roughnessMap: grain(), clearcoat: 0.18, clearcoatRoughness: 0.6 });
    const edge = new THREE.MeshPhysicalMaterial({ color: 0x2c2c2f, metalness: 0.92, roughness: 0.3, roughnessMap: grain() });
    const lines = mobile ? ['ABRAR', 'ALLI KHAN'] : ['ABRAR ALLI KHAN'];
    const S = 1 / FONT.upm, CAP = FONT.cap * S, TRACK = 0.1, LH = CAP * 1.5;
    const word = new THREE.Group(), letters = [];
    const geoCache = {};
    lines.forEach((ln, li) => {
      const row = new THREE.Group(); let x = 0;
      for (const ch of ln) {
        const adv = FONT.g[ch].w * S;
        if (ch !== ' ') {
          if (!geoCache[ch]) {
            const g = new THREE.ExtrudeGeometry(glyphShapes(ch), { depth: 90, bevelEnabled: true, bevelThickness: 18, bevelSize: 9, bevelSegments: 4, curveSegments: 10 });
            g.scale(S, S, S); g.translate(0, 0, -0.055); geoCache[ch] = g;
          }
          const pivot = new THREE.Group(); pivot.position.set(x + adv / 2, CAP / 2, 0);
          const m = new THREE.Mesh(geoCache[ch], [face.clone(), edge.clone()]); m.position.set(-adv / 2, -CAP / 2, 0);
          pivot.add(m); row.add(pivot); letters.push({ pivot, mesh: m, t: 0 });
        }
        x += adv + TRACK * CAP;
      }
      x -= TRACK * CAP;
      row.position.set(-x / 2, -li * LH, 0); row.userData.w = x; word.add(row);
    });
    const wmax = Math.max(...word.children.map(r => r.userData.w)), hTot = CAP + (lines.length - 1) * LH;
    word.position.y = (lines.length - 1) * LH / 2 - CAP / 2;
    const tilt = new THREE.Group(); tilt.add(word); scene.add(tilt);

    let W = 0, H = 0;
    function size() {
      W = host.clientWidth; if (!W) return;
      H = Math.round(Math.min(W * (hTot / wmax) * 1.55 + 24, mobile ? 230 : 210));
      host.style.height = H + 'px';
      renderer.setSize(W, H, false); cam.aspect = W / H;
      // keep the camera far away (long lens) so the extrusion never smears at the edges
      const d = wmax * 2.2;
      const halfH = Math.max((wmax / 2) / (0.86 * cam.aspect), (hTot / 2) / 0.62);
      cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfH / d));
      cam.position.set(0, 0, d); cam.near = d / 20; cam.far = d * 5; cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
      sweep.distance = d * 1.4;
    }
    size(); addEventListener('resize', size);
    host.classList.add('on');

    // input: gyroscope first, mouse on desktop
    let gx = 0, gy = 0, tx = 0, ty = 0, b0 = null;
    addEventListener('deviceorientation', e => {
      if (e.gamma == null) return; if (b0 == null) b0 = e.beta;
      ty = Math.max(-1, Math.min(1, e.gamma / 35)); tx = Math.max(-1, Math.min(1, (e.beta - b0) / 35));
    }, { passive: true });
    addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; ty = (e.clientX / innerWidth - 0.5) * 2; tx = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });

    let vis = false, swept = 0, sweepT = -1;
    new IntersectionObserver(es => es.forEach(e => { vis = e.isIntersecting; }), { rootMargin: '120px 0px' }).observe(host);
    const ease = t => 1 - Math.pow(1 - t, 3);
    const clamp = v => Math.max(0, Math.min(1, v));
    const t0 = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      if (!vis || document.hidden || !W) return;
      const r = host.getBoundingClientRect();
      // reveal: starts as the credit enters, finishes as it reaches the middle of the screen
      const atEnd = innerHeight + scrollY >= document.documentElement.scrollHeight - 6;
      const left = document.documentElement.scrollHeight - innerHeight - scrollY;
      const p = (reduce || atEnd) ? 1 : Math.max(clamp((innerHeight - r.top) / (innerHeight * 0.55 + r.height * 0.5)), clamp(1 - left / (innerHeight * 0.35)));
      const n = letters.length;
      letters.forEach((L, i) => {
        const target = clamp((p * 1.35 - (i / n) * 0.55) / 0.45);
        L.t += (target - L.t) * 0.14;
        const k = ease(L.t);
        L.pivot.position.z = (1 - k) * -0.6;
        L.pivot.rotation.x = (1 - k) * 1.25;
        L.pivot.scale.setScalar(0.86 + 0.14 * k);
        L.mesh.material.forEach(m => { const o = k; m.opacity = o; m.transparent = o < 0.995; m.depthWrite = o > 0.5; });
      });
      if (atEnd && swept === 0 && p > 0.95) { swept = 1; sweepT = now; host.classList.add('done'); }
      if (!atEnd && p < 0.5) { swept = 0; host.classList.remove('done'); }
      // one light pass over the metal at the very end of the page
      if (sweepT > 0) {
        const s = (now - sweepT) / 1600;
        if (s <= 1) { sweep.intensity = Math.sin(s * Math.PI) * 14; sweep.position.set((s - 0.5) * wmax * 1.4, CAP * 0.6, cam.position.z * 0.22); }
        else { sweep.intensity = 0; sweepT = -1; }
      }
      const idle = reduce ? 0 : (now - t0) / 1000;
      gx += (tx - gx) * 0.08; gy += (ty - gy) * 0.08;
      tilt.rotation.y = -0.06 + gy * (mobile ? 0.42 : 0.24) + Math.sin(idle * 0.6) * 0.04;
      tilt.rotation.x = 0.16 + gx * 0.28 + Math.cos(idle * 0.5) * 0.025;
      key.position.set(-2 + gy * 3, 3 - gx * 2, 5);
      renderer.render(scene, cam);
    }
    requestAnimationFrame(frame);
  }
}
