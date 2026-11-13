import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { IslandGrid } from './islandMesh';

/**
 * Low-poly trees (palm, broadleaf, pine) instanced per island,
 * swaying in the wind in the vertex shader.
 */

const windTime = { value: 0 };
export function updateVegetation(t: number) {
  windTime.value = t;
}

function paint(g: THREE.BufferGeometry, color: number) {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function palmGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  // curved trunk from 6 tapered segments
  let x = 0, y = 0;
  const segs = 6, H = 7;
  for (let i = 0; i < segs; i++) {
    const h = H / segs, r0 = 0.22 - i * 0.02, r1 = r0 - 0.02;
    const seg = new THREE.CylinderGeometry(r1, r0, h * 1.05, 7);
    const lean = 0.06 * i;
    seg.rotateZ(-lean);
    seg.translate(x + Math.sin(lean) * h / 2, y + h / 2, 0);
    parts.push(paint(seg, i % 2 ? 0x7a6040 : 0x8a7050));
    x += Math.sin(lean) * h; y += Math.cos(lean) * h;
  }
  // fronds: drooping two-segment blades
  const top = new THREE.Vector3(x, y, 0);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + (k % 2) * 0.2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.45);
    const len = 3.2 + (k % 3) * 0.4;
    const mid = top.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, 0.5, 0));
    const tip = top.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, -1.3, 0));
    const p = [top, mid.clone().add(side), mid.clone().sub(side), tip];
    const tri = [p[0], p[1], p[2], p[1], p[3], p[2]];
    const g = new THREE.BufferGeometry().setFromPoints(tri);
    g.computeVertexNormals();
    parts.push(paint(g, k % 2 ? 0x3e8a2a : 0x2f7a24));
  }
  for (let k = 0; k < 4; k++) {
    const nut = new THREE.IcosahedronGeometry(0.16, 0);
    nut.translate(x + Math.cos(k * 1.6) * 0.25, y - 0.25, Math.sin(k * 1.6) * 0.25);
    parts.push(paint(nut, 0x5a3a1a));
  }
  return mergeGeometries(parts)!;
}

function broadleafGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.3, 3.2, 6);
  trunk.translate(0, 1.6, 0);
  parts.push(paint(trunk, 0x5a4028));
  const blobs: [number, number, number, number, number][] = [
    [0, 4.2, 0, 1.9, 0x3d7a2a], [0.9, 3.7, 0.4, 1.3, 0x4a8a30], [-0.8, 3.8, -0.5, 1.4, 0x356e24], [0.1, 5.1, -0.3, 1.2, 0x4f9234],
  ];
  for (const [x, y, z, r, c] of blobs) {
    const b = new THREE.IcosahedronGeometry(r, 0);
    b.translate(x, y, z);
    parts.push(paint(b, c));
  }
  return mergeGeometries(parts)!;
}

function pineGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.22, 2, 6);
  trunk.translate(0, 1, 0);
  parts.push(paint(trunk, 0x4a3420));
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.ConeGeometry(1.8 - i * 0.45, 2.6, 7);
    cone.translate(0, 2.4 + i * 1.5, 0);
    parts.push(paint(cone, i % 2 ? 0x24502a : 0x2c5e30));
  }
  return mergeGeometries(parts)!;
}

export function swayMaterial(env: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide, envMap: env, envMapIntensity: 0.4 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWindTime = windTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
        #else
          vec2 ip = vec2(0.0);
        #endif
        float sway = sin(uWindTime * 1.3 + ip.x * 0.11 + ip.y * 0.07) + 0.4 * sin(uWindTime * 3.1 + ip.y * 0.2);
        float hk = max(position.y - 1.0, 0.0);
        transformed.x += sway * hk * hk * 0.004;
        transformed.z += sway * hk * hk * 0.0025;`,
      );
  };
  return m;
}

/** landing spot, island-relative while stored on the island; birds convert to local */
export interface Perch { x: number; y: number; z: number }

/** scatter trees over one island; returns meshes plus landing spots for birds */
export function plantIsland(grid: IslandGrid, mat: THREE.Material, geos: ReturnType<typeof treeGeometries>) {
  const I = grid.island;
  let seed = (Math.floor(I.x * 7 + I.z * 13) >>> 0) % 2147483646 || 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const area = Math.PI * Math.pow(I.r * 1.2, 2);
  const tries = Math.min(Math.round(area * 0.006), I.r > 900 ? 16000 : 6000);
  const lists: Record<'palm' | 'broad' | 'pine', THREE.Matrix4[]> = { palm: [], broad: [], pine: [] };
  const perches: Perch[] = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < tries; k++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * I.r * 1.45;
    const x = Math.cos(a) * r, z = Math.sin(a) * r; // island-relative
    const h = grid.sample(x, z);
    if (!(h > 0.6)) continue;
    const sl = grid.slope(x, z);
    if (h < 1.8 && sl < 0.25 && perches.length < 160) perches.push({ x, y: h, z });
    let kind: 'palm' | 'broad' | 'pine' | null = null;
    if (h > 1.2 && h < 6 && sl < 0.35) kind = rnd() < 0.55 ? 'palm' : null;
    else if (h >= 6 && h < I.h * 0.55 && sl < 0.5) kind = rnd() < 0.6 ? 'broad' : 'pine';
    else if (h >= I.h * 0.55 && h < I.h * 0.85 && sl < 0.7) kind = rnd() < 0.7 ? 'pine' : null;
    if (!kind) continue;
    const sc = (kind === 'palm' ? 0.8 : 0.7) + rnd() * 0.7;
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    s.set(sc, sc * (0.85 + rnd() * 0.3), sc);
    p.set(x, h - 0.15, z);
    lists[kind].push(new THREE.Matrix4().compose(p, q, s));
  }
  const meshes: THREE.InstancedMesh[] = [];
  for (const kind of ['palm', 'broad', 'pine'] as const) {
    const L = lists[kind];
    if (!L.length) continue;
    const m = new THREE.InstancedMesh(geos[kind], mat, L.length);
    L.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.computeBoundingSphere();
    m.castShadow = true;
    meshes.push(m);
  }
  return { meshes, perches };
}

export function treeGeometries() {
  return { palm: palmGeometry(), broad: broadleafGeometry(), pine: pineGeometry() };
}
