import * as THREE from 'three';
import { NOISE_DATA } from '../sky';
import { ORIGIN } from './origin';

/**
 * Infinite procedural archipelago.
 *
 * Islands come from a deterministic hash of world cells (absolute coords):
 *  - CELL (1.6 km): 0–2 small/medium/large islands
 *  - SUPER (9 km): sometimes one very large island (suppresses small ones nearby)
 *
 * One height function, evaluated identically on CPU (placement, buoyancy,
 * collisions) and GPU (ocean shallows, wave damping). Noise is sampled in
 * island-relative coordinates so it is independent of the floating origin.
 */

export interface Island {
  id: string;
  x: number; // absolute centre
  z: number;
  r: number; // nominal coast radius (m)
  h: number; // peak height (m)
  seed: number; // 0…63, decorrelates noise between islands
}

export const SEABED = -40;
const CELL = 1600;
const SUPER = 9000;
const INFLUENCE = 2.2; // islandH is non-trivial within INFLUENCE * r
const START_CLEAR = 160; // keep the spawn point in open water

function hash2(x: number, z: number, s: number) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const ckey = (a: number, b: number) => (a + 32768) * 65536 + (b + 32768);
const superCache = new Map<number, Island[]>();
function superIslands(sx: number, sz: number): Island[] {
  let v = superCache.get(ckey(sx, sz));
  if (v) return v;
  v = [];
  if (hash2(sx, sz, 1) < 0.55 && !(sx === 0 && sz === 0)) {
    const r = 900 + hash2(sx, sz, 2) * 900;
    v.push({
      id: `S${sx},${sz}`,
      x: (sx + 0.25 + hash2(sx, sz, 3) * 0.5) * SUPER,
      z: (sz + 0.25 + hash2(sx, sz, 4) * 0.5) * SUPER,
      r, h: 150 + hash2(sx, sz, 5) * 140, seed: Math.floor(hash2(sx, sz, 6) * 64),
    });
  }
  superCache.set(ckey(sx, sz), v);
  return v;
}

const cellCache = new Map<number, Island[]>();
function cellIslands(cx: number, cz: number): Island[] {
  let v = cellCache.get(ckey(cx, cz));
  if (v) return v;
  v = [];
  const n = hash2(cx, cz, 10) < 0.38 ? 0 : hash2(cx, cz, 11) < 0.8 ? 1 : 2;
  for (let k = 0; k < n; k++) {
    const roll = hash2(cx, cz, 20 + k);
    const r = roll < 0.72 ? 35 + hash2(cx, cz, 30 + k) * 70 : 140 + hash2(cx, cz, 30 + k) * 300;
    const m = Math.min(r * 1.6, CELL * 0.35); // keep inside its cell
    const x = cx * CELL + m + hash2(cx, cz, 40 + k) * (CELL - 2 * m);
    const z = cz * CELL + m + hash2(cx, cz, 50 + k) * (CELL - 2 * m);
    if (Math.hypot(x, z) < START_CLEAR + r * 1.5) continue;
    // no small islands inside a giant one
    const sx = Math.floor(x / SUPER), sz = Math.floor(z / SUPER);
    let blocked = false;
    for (let a = -1; a <= 1 && !blocked; a++)
      for (let b = -1; b <= 1 && !blocked; b++)
        for (const g of superIslands(sx + a, sz + b)) if (Math.hypot(x - g.x, z - g.z) < g.r * 1.9 + r * 2) blocked = true;
    if (blocked) continue;
    const h = r < 110 ? 6 + r * 0.16 + hash2(cx, cz, 60 + k) * 6 : 25 + r * 0.15 + hash2(cx, cz, 60 + k) * 30;
    v.push({ id: `C${cx},${cz}:${k}`, x, z, r, h, seed: Math.floor(hash2(cx, cz, 70 + k) * 64) });
  }
  // hand-placed friendly islands around the start
  if (cx === 0 && cz === 0) v.push({ id: 'home1', x: 180, z: -260, r: 45, h: 9, seed: 1 }, { x: 420, z: 380, r: 35, h: 7, seed: 2, id: 'home2' });
  if (cx === -1 && cz === 0) v.push({ id: 'home3', x: -320, z: 140, r: 60, h: 14, seed: 3 });
  if (cx === 0 && cz === -1) v.push({ id: 'home4', x: 150, z: -760, r: 80, h: 18, seed: 4 });
  cellCache.set(ckey(cx, cz), v);
  return v;
}

/** all islands whose influence zone touches the circle (absolute coords) */
export function islandsNear(ax: number, az: number, radius: number, out: Island[] = []) {
  out.length = 0;
  const c0x = Math.floor((ax - radius - 1000) / CELL), c1x = Math.floor((ax + radius + 1000) / CELL);
  const c0z = Math.floor((az - radius - 1000) / CELL), c1z = Math.floor((az + radius + 1000) / CELL);
  for (let cx = c0x; cx <= c1x; cx++)
    for (let cz = c0z; cz <= c1z; cz++)
      for (const I of cellIslands(cx, cz)) if (Math.hypot(ax - I.x, az - I.z) < I.r * INFLUENCE + radius) out.push(I);
  const s0x = Math.floor((ax - radius - 4000) / SUPER), s1x = Math.floor((ax + radius + 4000) / SUPER);
  const s0z = Math.floor((az - radius - 4000) / SUPER), s1z = Math.floor((az + radius + 4000) / SUPER);
  for (let sx = s0x; sx <= s1x; sx++)
    for (let sz = s0z; sz <= s1z; sz++)
      for (const I of superIslands(sx, sz)) if (Math.hypot(ax - I.x, az - I.z) < I.r * INFLUENCE + radius) out.push(I);
  return out;
}

// ---------- CPU mirror of the GLSL noise ----------
function tex(x: number, y: number) {
  return NOISE_DATA[(((y & 255) << 8) | (x & 255)) << 2] / 255;
}
function vnoise(px: number, py: number) {
  const ix = Math.floor(px), iy = Math.floor(py);
  let fx = px - ix, fy = py - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = tex(ix, iy), b = tex(ix + 1, iy), c = tex(ix, iy + 1), d = tex(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
function fbm3(px: number, py: number) {
  let s = 0.5 * vnoise(px, py);
  const x = 1.6 * px - 1.2 * py, y = 1.2 * px + 1.6 * py;
  s += 0.25 * vnoise(x, y);
  const x2 = 1.6 * x - 1.2 * y, y2 = 1.2 * x + 1.6 * y;
  return s + 0.125 * vnoise(x2, y2) + 0.0625;
}

/** height of one island at offset (dx,dz) from its centre */
export function islandHRel(dx: number, dz: number, I: Island) {
  const dist = Math.hypot(dx, dz);
  if (dist > I.r * INFLUENCE) return -1e3;
  const n = fbm3(dx / I.r * 2.5 + I.seed * 17, dz / I.r * 2.5);
  const t = dist / (I.r * (0.7 + 0.6 * n));
  if (t < 1) {
    const u = 1 - t;
    const rough = 0.7 + 0.6 * fbm3(dx / I.r * 6 + I.seed * 5, dz / I.r * 6);
    return I.h * Math.pow(u, 1.8) * rough + u * 1.2;
  }
  return -(t - 1) * I.r * 0.35;
}

/** terrain height at ABSOLUTE xz given a pre-gathered island list */
export function terrainHeightAbs(ax: number, az: number, list: Island[]) {
  let h = SEABED;
  for (const I of list) h = Math.max(h, islandHRel(ax - I.x, az - I.z, I));
  return h;
}

const _near: Island[] = [];
/** terrain height at LOCAL xz (seabed where there is no island) */
export function terrainHeight(lx: number, lz: number) {
  const ax = lx + ORIGIN.x, az = lz + ORIGIN.z;
  islandsNear(ax, az, 0, _near);
  let h = SEABED;
  for (const I of _near) h = Math.max(h, islandHRel(ax - I.x, az - I.z, I));
  return h;
}

/** true if any island's influence zone reaches within `radius` of LOCAL x,z — cheap pre-check */
export function nearTerrain(lx: number, lz: number, radius: number) {
  return islandsNear(lx + ORIGIN.x, lz + ORIGIN.z, radius, _near).length > 0;
}

/** 0 on land/very shallow → 1 in open water: how much of the swell survives */
export function shoreFade(depth: number) {
  const t = Math.min(Math.max((depth - 0.3) / (10 - 0.3), 0), 1);
  return t * t * (3 - 2 * t);
}

// ---------- GPU: the N islands nearest to the camera ----------
export const GPU_ISLANDS = 16;
/** (localX, localZ, r, h) – r = 0 marks an empty slot */
export const islandUniform = Array.from({ length: GPU_ISLANDS }, () => new THREE.Vector4(0, 0, 0, 0));
export const islandSeedUniform = new Array<number>(GPU_ISLANDS).fill(0);
const _cand: Island[] = [];
/** pick the islands nearest to the camera (LOCAL coords) for the shaders */
export function updateGpuIslands(camLx: number, camLz: number) {
  const ax = camLx + ORIGIN.x, az = camLz + ORIGIN.z;
  islandsNear(ax, az, 9000, _cand);
  _cand.sort((a, b) => (Math.hypot(ax - a.x, az - a.z) - a.r) - (Math.hypot(ax - b.x, az - b.z) - b.r));
  for (let i = 0; i < GPU_ISLANDS; i++) {
    const I = _cand[i];
    if (I) { islandUniform[i].set(I.x - ORIGIN.x, I.z - ORIGIN.z, I.r, I.h); islandSeedUniform[i] = I.seed; }
    else { islandUniform[i].set(1e6, 1e6, 0, 0); islandSeedUniform[i] = 0; }
  }
}

export const TERRAIN_GLSL = /* glsl */ `
#define ISL_N ${GPU_ISLANDS}
uniform vec4 uIsl[ISL_N];
uniform float uIslSeed[ISL_N];
float islandH(vec2 p, vec4 I, float seed){
  vec2 q = p - I.xy;
  float dist = length(q);
  if (I.z <= 0.0 || dist > I.z * ${INFLUENCE.toFixed(1)}) return -1e3;
  float n = fbm3(vec2(q.x / I.z * 2.5 + seed * 17.0, q.y / I.z * 2.5));
  float t = dist / (I.z * (0.7 + 0.6 * n));
  if (t < 1.0) {
    float u = 1.0 - t;
    float rough = 0.7 + 0.6 * fbm3(vec2(q.x / I.z * 6.0 + seed * 5.0, q.y / I.z * 6.0));
    return I.w * pow(u, 1.8) * rough + u * 1.2;
  }
  return -(t - 1.0) * I.z * 0.35;
}
float terrainHeight(vec2 p){
  float h = ${SEABED.toFixed(1)};
  for (int i = 0; i < ISL_N; i++) h = max(h, islandH(p, uIsl[i], uIslSeed[i]));
  return h;
}
float shoreFade(float depth){ return smoothstep(0.3, 10.0, depth); }
`;
