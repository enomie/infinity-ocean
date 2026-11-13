import * as THREE from 'three';
import { type Island, islandsNear, terrainHeightAbs } from './terrain';

/**
 * Height grid of one island in ISLAND-RELATIVE coordinates (origin independent).
 * Built incrementally by `build()` (a generator yielding every few rows) so the
 * streaming world can spread the work over frames.
 */
export class IslandGrid {
  readonly half: number;
  readonly step: number;
  readonly heights: Float32Array;
  private near: Island[];
  done = false;
  constructor(readonly island: Island, readonly res: number) {
    this.half = island.r * 1.9;
    this.step = (this.half * 2) / res;
    this.heights = new Float32Array((res + 1) * (res + 1));
    this.near = islandsNear(island.x, island.z, this.half * 1.42).slice();
  }
  *build(): Generator<void> {
    const n = this.res + 1, I = this.island;
    for (let j = 0; j < n; j++) {
      const az = I.z - this.half + j * this.step;
      for (let i = 0; i < n; i++) this.heights[j * n + i] = terrainHeightAbs(I.x - this.half + i * this.step, az, this.near);
      if ((j & 3) === 3) yield;
    }
    this.done = true;
  }
  /** bilinear height at island-relative (dx, dz); NaN outside */
  sample(dx: number, dz: number) {
    const fx = (dx + this.half) / this.step, fz = (dz + this.half) / this.step;
    if (fx < 0 || fz < 0 || fx >= this.res || fz >= this.res) return NaN;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, n = this.res + 1;
    const h = this.heights;
    const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  /** slope (0 flat … 1 = 45°) at island-relative coords */
  slope(dx: number, dz: number) {
    const e = this.step;
    const gx = (this.sample(dx + e, dz) - this.sample(dx - e, dz)) / (2 * e);
    const gz = (this.sample(dx, dz + e) - this.sample(dx, dz - e)) / (2 * e);
    return Math.hypot(gx, gz);
  }
}

const SAND = new THREE.Color(0xe6d3a3), WET = new THREE.Color(0xb39a6a), SEABED = new THREE.Color(0xc8b88c);
const GRASS = new THREE.Color(0x4f8a2e), GRASS2 = new THREE.Color(0x2f6a22), ROCK = new THREE.Color(0x7a746a), DIRT = new THREE.Color(0x8a7a52);

function hash(x: number, z: number) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** terrain surface colour by height, slope and a little noise */
export function terrainColor(h: number, slope: number, peak: number, x: number, z: number, out: THREE.Color) {
  const n = hash(Math.floor(x / 3), Math.floor(z / 3)) * 0.6 + hash(x, z) * 0.4;
  const beachTop = 1.6 + n * 1.2;
  if (h < -0.4) out.copy(SEABED).lerp(WET, THREE.MathUtils.clamp(-h / 25, 0, 0.6));
  else if (h < 0.4) out.copy(WET);
  else if (h < beachTop) out.copy(SAND).lerp(WET, Math.max(0, 1 - h / 1.0) * 0.6);
  else {
    out.copy(GRASS).lerp(GRASS2, THREE.MathUtils.clamp(h / (peak * 0.8) + n * 0.3, 0, 1));
    if (h < beachTop + 1.2) out.lerp(SAND, 1 - (h - beachTop) / 1.2); // soft sand → grass edge
    if (h > peak * 0.75) out.lerp(ROCK, THREE.MathUtils.smoothstep(h, peak * 0.75, peak * 0.95));
    if (slope > 0.55) out.lerp(slope > 0.9 ? ROCK : DIRT, THREE.MathUtils.smoothstep(slope, 0.55, 0.95));
  }
  return out;
}

/** mesh in island-relative coords; caller positions it at (island − ORIGIN) */
export function buildIslandMesh(grid: IslandGrid, mat: THREE.Material) {
  const { res, half, step, island } = grid;
  const n = res + 1;
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
  const c = new THREE.Color();
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = -half + i * step, z = -half + j * step; // island-relative
      const h = grid.heights[k];
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const sl = i > 0 && j > 0 && i < res && j < res
        ? Math.hypot(grid.heights[k + 1] - grid.heights[k - 1], grid.heights[k + n] - grid.heights[k - n]) / (2 * step)
        : 0;
      terrainColor(h, sl, island.h, x + island.seed * 97, z, c);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
  const idx = new Uint32Array(res * res * 6);
  let p = 0;
  for (let j = 0; j < res; j++)
    for (let i = 0; i < res; i++) {
      const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
      idx[p++] = a; idx[p++] = cc; idx[p++] = b;
      idx[p++] = b; idx[p++] = cc; idx[p++] = d;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export function terrainMaterial(env: THREE.Texture) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, envMap: env, envMapIntensity: 0.35 });
}
