import * as THREE from 'three';
import { type Island, islandsNear, updateGpuIslands } from './terrain';
import { buildIslandMesh, IslandGrid, terrainMaterial } from './islandMesh';
import { type Perch, plantIsland, swayMaterial, treeGeometries, updateVegetation } from './vegetation';
import { ORIGIN } from './origin';

export { terrainHeight, islandUniform, islandSeedUniform } from './terrain';
export type { Perch } from './vegetation';

/** streaming distances (m, from camera to island coast) */
const LOAD_DIST = 9000; // island terrain appears (coarse)
const FINE_DIST = 1800; // full-resolution grid
const TREE_DIST = 3500; // vegetation planted / kept
const UNLOAD_DIST = 11000;
const BUILD_BUDGET_MS = 2.0; // per frame

function fineRes(I: Island) {
  return I.r > 900 ? 768 : I.r > 200 ? 384 : Math.max(112, Math.round(I.r / 0.75));
}
function coarseRes(I: Island) {
  return Math.max(32, Math.round(fineRes(I) / 4));
}

interface Loaded {
  island: Island;
  group: THREE.Group; // positioned at island − ORIGIN
  terrain: THREE.Mesh | null;
  trees: THREE.InstancedMesh[];
  grid: IslandGrid | null; // grid the current mesh was built from
  lod: 'coarse' | 'fine' | null;
  perches: Perch[];
  job: { grid: IslandGrid; it: Generator<void>; lod: 'coarse' | 'fine' } | null;
  coastDist: number;
}

/**
 * Infinite world: islands stream in around the camera from the procedural
 * registry, get a coarse LOD first and a fine LOD when close, vegetation when
 * nearer still. Mesh building is time-sliced to keep frame times flat.
 */
export class World {
  readonly group = new THREE.Group();
  private loaded = new Map<string, Loaded>();
  private terrainMat: THREE.Material;
  private treeMat: THREE.Material;
  private geos = treeGeometries();
  private scanTimer = 0;
  private near: Island[] = [];

  constructor(env: THREE.Texture) {
    this.terrainMat = terrainMaterial(env);
    this.treeMat = swayMaterial(env);
  }

  /** camL: camera position in LOCAL coords. `budgetMs` can be raised for loading screens / warp */
  update(t: number, camL: THREE.Vector3, budgetMs = BUILD_BUDGET_MS) {
    updateVegetation(t);
    const ax = camL.x + ORIGIN.x, az = camL.z + ORIGIN.z;

    this.scanTimer -= 1;
    if (this.scanTimer <= 0) {
      this.scanTimer = 20;
      updateGpuIslands(camL.x, camL.z);
      islandsNear(ax, az, LOAD_DIST, this.near);
      for (const I of this.near) if (!this.loaded.has(I.id)) this.add(I);
      for (const L of this.loaded.values()) {
        L.coastDist = Math.hypot(ax - L.island.x, az - L.island.z) - L.island.r;
        if (L.coastDist > UNLOAD_DIST) this.remove(L);
      }
    }
    for (const L of this.loaded.values()) L.coastDist = Math.hypot(ax - L.island.x, az - L.island.z) - L.island.r;

    // schedule: want fine near, coarse otherwise; nearest first
    const todo = [...this.loaded.values()].sort((a, b) => a.coastDist - b.coastDist);
    const t0 = performance.now();
    for (const L of todo) {
      const want = L.coastDist < FINE_DIST ? 'fine' : 'coarse';
      if (!L.job && L.lod !== want && !(L.lod === 'fine' && want === 'coarse')) {
        const grid = new IslandGrid(L.island, want === 'fine' ? fineRes(L.island) : coarseRes(L.island));
        L.job = { grid, it: grid.build(), lod: want };
      }
      while (L.job && performance.now() - t0 < budgetMs) {
        if (L.job.it.next().done) this.finish(L);
      }
      // trees follow distance
      if (L.grid && L.trees.length === 0 && L.coastDist < TREE_DIST && performance.now() - t0 < budgetMs) this.plant(L);
      if (L.trees.length && L.coastDist > TREE_DIST + 800) this.clearTrees(L);
      if (performance.now() - t0 >= budgetMs) break;
    }
  }

  private add(I: Island) {
    const group = new THREE.Group();
    group.position.set(I.x - ORIGIN.x, 0, I.z - ORIGIN.z);
    this.group.add(group);
    this.loaded.set(I.id, { island: I, group, terrain: null, trees: [], grid: null, lod: null, perches: [], job: null, coastDist: 1e9 });
  }

  private finish(L: Loaded) {
    const job = L.job!;
    L.job = null;
    if (L.terrain) { L.group.remove(L.terrain); L.terrain.geometry.dispose(); }
    L.terrain = buildIslandMesh(job.grid, this.terrainMat);
    L.group.add(L.terrain);
    L.grid = job.grid;
    L.lod = job.lod;
    if (L.trees.length) { this.clearTrees(L); } // replant on the better grid
  }

  private plant(L: Loaded) {
    const { meshes, perches } = plantIsland(L.grid!, this.treeMat, this.geos);
    meshes.forEach((m) => L.group.add(m));
    L.trees = meshes;
    L.perches = perches;
  }

  private clearTrees(L: Loaded) {
    for (const m of L.trees) { L.group.remove(m); m.dispose(); }
    L.trees = [];
  }

  private remove(L: Loaded) {
    this.clearTrees(L);
    if (L.terrain) L.terrain.geometry.dispose();
    this.group.remove(L.group);
    this.loaded.delete(L.island.id);
  }

  /** floating origin moved by (dx, dz): re-place island groups */
  onOriginShift() {
    for (const L of this.loaded.values()) L.group.position.set(L.island.x - ORIGIN.x, 0, L.island.z - ORIGIN.z);
    this.scanTimer = 0;
  }

  /** nearest loaded island with perches whose coast is within maxDist of LOCAL x,z; perches returned in LOCAL coords */
  nearestIsland(lx: number, lz: number, maxDist: number) {
    const ax = lx + ORIGIN.x, az = lz + ORIGIN.z;
    let best: Loaded | null = null, bd = maxDist;
    for (const L of this.loaded.values()) {
      if (!L.perches.length) continue;
      const d = Math.hypot(ax - L.island.x, az - L.island.z) - L.island.r;
      if (d < bd) { bd = d; best = L; }
    }
    if (!best) return null;
    const ox = best.island.x - ORIGIN.x, oz = best.island.z - ORIGIN.z;
    return { x: ox, z: oz, r: best.island.r, perches: best.perches.map((p) => ({ x: p.x + ox, y: p.y, z: p.z + oz })) };
  }

  get stats() {
    let fine = 0, coarse = 0, trees = 0;
    for (const L of this.loaded.values()) {
      if (L.lod === 'fine') fine++; else if (L.lod === 'coarse') coarse++;
      for (const m of L.trees) trees += m.count;
    }
    return { loaded: this.loaded.size, fine, coarse, trees };
  }
}
