import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface HullParams {
  len: number;
  beam: number;
  draft: number;
  free: number; // freeboard amidships
  bowRise?: number; // extra sheer at bow
  bowLen?: number; // fraction of length that tapers (0..1)
  sternW?: number; // transom width factor
  bottom?: number; // antifouling colour
  stripe?: number;
  top?: number;
  deck?: number;
  boot?: number; // height of antifouling above waterline
  crown?: number; // deck camber height (m)
  vee?: boolean; // deep-V planing sections instead of round bilge
  /** optional GLSL statements painting the hull procedurally. In scope: `vec3 p` (object space,
   *  bow at -z), `float s` (0 bow → 1 stern), `float y`, `aa(edge, x)` (crisp anti-aliased step),
   *  and `vec3 c` (base livery, write the result back into c). */
  hullPaint?: string;
  /** same for the deck; `float a` = -1 port … +1 starboard (relative to local half width) */
  deckPaint?: string;
  gloss?: boolean;
}

const AA_GLSL = /* glsl */ `
float aa(float e, float x){ float w = max(fwidth(x), 1e-5) * 0.75; return smoothstep(e - w, e + w, x); }
`;

/**
 * Shader livery: colour is computed per pixel from object-space position, so paint
 * borders are razor sharp (no vertex-colour gradients) and need no textures.
 */
export function paintMaterial(env: THREE.Texture, body: string, uniforms: Record<string, THREE.IUniform>, params: THREE.MeshStandardMaterialParameters = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.35, envMap: env, ...params });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    const decl = Object.entries(uniforms).map(([k, u]) =>
      `uniform ${u.value instanceof THREE.Color ? 'vec3' : 'float'} ${k};`).join('\n');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;\nvObjN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObj;\nvarying vec3 vObjN;\n${decl}\n${AA_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n{ vec3 p = vObj; vec3 c = diffuseColor.rgb;\n${body}\n diffuseColor.rgb = c; }`);
  };
  m.customProgramCacheKey = () => body + Object.keys(uniforms).join();
  return m;
}

/** Simple parametric hull: round-bilge sections, tapered bow, flat transom, deck. */
export function buildHull(p: HullParams, env: THREE.Texture) {
  const { len, beam, draft, free } = p;
  const bowRise = p.bowRise ?? free * 0.4;
  const bowLen = p.bowLen ?? 0.45;
  const sternW = p.sternW ?? 0.88;
  const boot = p.boot ?? Math.max(0.22, draft * 0.12, free * 0.25);
  const halfW = (s: number) =>
    (beam / 2) * (s < bowLen ? 1 - Math.pow(1 - s / bowLen, 2) : 1 - (1 - sternW) * Math.pow((s - bowLen) / (1 - bowLen), 2));
  const dr = (s: number) => draft * THREE.MathUtils.smoothstep(s, 0, bowLen * 0.7) + draft * 0.05;
  const sheer = (s: number) => free + bowRise * Math.pow(1 - s, 2.2);

  const NS = 48, NT = 16;
  const pos: number[] = [], idx: number[] = [];
  const cBottom = new THREE.Color(p.bottom ?? 0x731010), cStripe = new THREE.Color(p.stripe ?? 0x0b1530), cTop = new THREE.Color(p.top ?? 0xb8bab8);
  const ring = (s: number) => {
    const w = halfW(s), d = dr(s), f = sheer(s);
    const pts: [number, number][] = [];
    for (let t = 0; t <= NT; t++) {
      const u = t / NT;
      if (u < 0.6 && p.vee) {
        const a = u / 0.6; // straight deadrise with a small chine flat
        pts.push([w * 0.97 * Math.min(a * 1.08, 1), -d * (1 - a)]);
      } else if (u < 0.6) {
        const th = (u / 0.6) * Math.PI * 0.5;
        pts.push([w * Math.pow(Math.sin(th), 0.6) * 0.97, -d * Math.cos(th)]);
      } else {
        const v = (u - 0.6) / 0.4;
        pts.push([w * (0.97 + 0.05 * v), v * f]);
      }
    }
    return pts;
  };
  for (const side of [1, -1])
    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      ring(s).forEach(([x, y]) => {
        pos.push(side * x, y, -len / 2 + s * len);
      });
    }
  const rowLen = NT + 1, sideLen = (NS + 1) * rowLen;
  for (let k = 0; k < 2; k++)
    for (let i = 0; i < NS; i++)
      for (let t = 0; t < NT; t++) {
        const a = k * sideLen + i * rowLen + t, b = a + rowLen;
        if (k === 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
  const base = pos.length / 3;
  const st = ring(1);
  for (const sx of [1, -1]) st.forEach(([x, y]) => pos.push(sx * x, y, len / 2));
  for (let t = 0; t < NT; t++) {
    const a = base + t, b = base + rowLen + t;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  // deck
  const dp: number[] = [], di: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const s = i / 40, w = halfW(s), y = sheer(s) - 0.02, z = -len / 2 + s * len;
    for (let j = 0; j <= 8; j++) {
      const a = j / 8 * 2 - 1; // -1 port … +1 starboard
      dp.push(a * w, y + (p.crown ?? 0) * (1 - a * a) * Math.min(1, w / (beam / 2) * 1.5), z);
    }
  }
  for (let i = 0; i < 40; i++) for (let j = 0; j < 8; j++) {
    const a = i * 9 + j, b = a + 9;
    di.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  dg.setIndex(di);
  dg.computeVertexNormals();

  const group = new THREE.Group();
  const stripeH = Math.max(0.15, free * 0.12);
  const rough = p.gloss ? { roughness: 0.18, envMapIntensity: 1.3 } : { roughness: 0.4 };
  const hullU = {
    uBottom: { value: cBottom }, uStripe: { value: cStripe }, uTop: { value: cTop },
    uBoot: { value: boot }, uStripeH: { value: stripeH }, uLen: { value: len },
  };
  const hullBody = `
    float y = p.y, s = clamp((p.z + uLen * 0.5) / uLen, 0.0, 1.0);
    c = mix(uBottom, uStripe, aa(uBoot, y));
    c = mix(c, uTop, aa(uBoot + uStripeH, y));
    ${p.hullPaint ?? ''}`;
  group.add(new THREE.Mesh(g, paintMaterial(env, hullBody, hullU, { ...rough, side: THREE.DoubleSide })));
  const deckU = { uDeck: { value: new THREE.Color(p.deck ?? 0x8a6240) }, uLen: { value: len }, uBeam: { value: beam } };
  const deckBody = `
    float s = clamp((p.z + uLen * 0.5) / uLen, 0.0, 1.0);
    float a = p.x / (uBeam * 0.5);
    c = uDeck;
    ${p.deckPaint ?? ''}`;
  group.add(new THREE.Mesh(dg, paintMaterial(env, deckBody, deckU, p.deckPaint ? rough : { roughness: 0.75, envMapIntensity: 0.6 })));
  return { group, halfW, sheer };
}

/** tiny helpers for superstructure */
export function mat(env: THREE.Texture, color: number, roughness = 0.5, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: env });
}
export function box(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}
export function cyl(m: THREE.Material, r: number, h: number, x: number, y: number, z: number, r2 = r) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, h, 16), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

/** bake many parts into ONE mesh (one draw call); parts keep their position/rotation/scale */
export function merged(m: THREE.Material, parts: THREE.Mesh[]) {
  const geos = parts.map((p) => { p.updateMatrix(); const g = p.geometry.clone().applyMatrix4(p.matrix); return g.index ? g : g; });
  return new THREE.Mesh(mergeGeometries(geos), m);
}

/** propeller: hub + twisted blades merged into one mesh (one draw call); spins around local z */
export function buildScrew(env: THREE.Texture, r: number, blades = 4) {
  const parts: THREE.Mesh[] = [];
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.24, r * 0.55, 12));
  hub.rotation.x = Math.PI / 2; parts.push(hub);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.18, r * 0.3, 12));
  cone.rotation.x = Math.PI / 2; cone.position.z = r * 0.42; parts.push(cone);
  for (let i = 0; i < blades; i++) {
    // blade = flattened sphere (rounded paddle), pitched like a real screw
    const b = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6));
    b.scale.set(r * 0.26, r * 0.48, r * 0.035);
    const piv = new THREE.Object3D();
    piv.rotation.z = (i / blades) * Math.PI * 2;
    b.position.y = r * 0.52; b.rotation.y = 0.65; b.rotation.z = 0.15;
    piv.add(b); piv.updateMatrixWorld(true);
    const m = new THREE.Mesh(b.geometry.clone().applyMatrix4(b.matrixWorld));
    parts.push(m);
  }
  const bronze = new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.3, metalness: 0.9, envMap: env });
  return merged(bronze, parts);
}

/** thin rod from a to b (for railings, masts, braces) */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 4) {
  const d = b.clone().sub(a), len = d.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, sides, 1, true));
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return mesh;
}

/** deck-edge railing (posts + 2 rails) along the sheer line, as one merged mesh */
export function railing(m: THREE.Material, len: number, halfW: (s: number) => number, sheer: (s: number) => number,
  opts: { from?: number; to?: number; spacing?: number; height?: number; r?: number; inset?: number } = {}) {
  const { from = 0.02, to = 0.99, spacing = 2.5, height = 1.1, r = 0.05, inset = 0.25 } = opts;
  const n = Math.max(2, Math.round(((to - from) * len) / spacing));
  const parts: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    let prev: THREE.Vector3[] | null = null;
    for (let i = 0; i <= n; i++) {
      const s = from + ((to - from) * i) / n;
      const base = new THREE.Vector3(side * (halfW(s) - inset), sheer(s) - 0.05, -len / 2 + s * len);
      const lv = [0.5, 1].map((k) => base.clone().setY(base.y + height * k));
      parts.push(rod(base, lv[1], r));
      if (prev) for (let k = 0; k < 2; k++) parts.push(rod(prev[k], lv[k], k ? r * 1.2 : r * 0.8));
      prev = lv;
    }
  }
  return merged(m, parts);
}
