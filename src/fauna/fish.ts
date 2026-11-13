import * as THREE from 'three';
import { nearTerrain, SEABED, terrainHeight } from '../world/terrain';

/**
 * Marine life: instanced low-poly fish schools + great white sharks.
 * Swim motion (body undulation) runs in the vertex shader; CPU only moves
 * school centres / sharks and writes one matrix per fish.
 */

const timeU = { value: 0 };

/** MeshStandardMaterial + travelling-wave body bend along local z (head at -z, tail at +z) */
function swimMaterial(params: THREE.MeshStandardMaterialParameters, len: number, freq: number, amp: number, env: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ ...params, flatShading: true, envMap: env, envMapIntensity: 1.4 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSwimTime = timeU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwimTime;\nattribute float aPhase;\nattribute float aRate;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float tz = clamp((position.z + ${(len * 0.25).toFixed(3)}) / ${(len * 0.8).toFixed(3)}, 0.0, 1.0);
        float ph = uSwimTime * ${freq.toFixed(2)} * aRate + aPhase - position.z * ${(5.0 / len).toFixed(3)};
        transformed.x += sin(ph) * ${amp.toFixed(3)} * tz * tz;`,
      );
  };
  return m;
}

function withPhase(g: THREE.BufferGeometry, instances = 1) {
  const ph = new Float32Array(instances), rate = new Float32Array(instances);
  for (let i = 0; i < instances; i++) { ph[i] = Math.random() * 6.28; rate[i] = 0.8 + Math.random() * 0.4; }
  g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
  g.setAttribute('aRate', new THREE.InstancedBufferAttribute(rate, 1));
  return g;
}

/** body shape + paint for one species */
interface FishShape {
  len: number;
  height: number; // body height relative to length (0.16 = slim, 0.4 = disc)
  width: number; // body thickness relative to height
  back: number;
  belly: number;
  fin?: number;
  stripes?: { color: number; count: number; width: number }; // vertical bands
  lateral?: number; // horizontal line colour (mackerel/barracuda look)
  tail?: 'fork' | 'round' | 'lunate';
  dorsal?: number; // dorsal fin height relative to length
  snout?: number; // how pointy the head is (0..1)
}

/** low-poly fish: 6-sided spindle with configurable profile, tail and paint */
function fishGeometry(f: FishShape) {
  const pos: number[] = [], col: number[] = [];
  const L = f.len, H = f.height * L, W = f.width;
  const ring = (z: number, h: number) =>
    [0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      return new THREE.Vector3(Math.cos(a) * h * W, Math.sin(a) * h, z);
    });
  const sn = f.snout ?? 0.4;
  const rings = [
    ring(-0.5 * L, 0.0),
    ring(-0.38 * L, H * (0.75 - sn * 0.4)),
    ring(-0.12 * L, H),
    ring(0.15 * L, H * 0.75),
    ring(0.36 * L, H * 0.22),
  ];
  const back = new THREE.Color(f.back), belly = new THREE.Color(f.belly), finC = new THREE.Color(f.fin ?? f.back);
  const stripe = f.stripes ? new THREE.Color(f.stripes.color) : null;
  const lat = f.lateral !== undefined ? new THREE.Color(f.lateral) : null;
  const colorAt = (v: THREE.Vector3) => {
    const t = THREE.MathUtils.clamp(v.y / H * 0.5 + 0.5, 0, 1);
    const c = belly.clone().lerp(back, Math.pow(t, 1.3));
    if (stripe && f.stripes) {
      const u = (v.z / L + 0.5) * f.stripes.count;
      if (Math.abs(u - Math.round(u)) < f.stripes.width && v.z > -0.42 * L) c.copy(stripe);
    }
    if (lat && Math.abs(v.y) < H * 0.12) c.lerp(lat, 0.8);
    return c;
  };
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, fixed?: THREE.Color) => {
    for (const v of [a, b, c]) {
      pos.push(v.x, v.y, v.z);
      const cc = fixed ?? colorAt(v);
      col.push(cc.r, cc.g, cc.b);
    }
  };
  // subdivide body lengthwise so stripes resolve
  const lerpRing = (r0: THREE.Vector3[], r1: THREE.Vector3[], t: number) => r0.map((v, i) => v.clone().lerp(r1[i], t));
  const dense: THREE.Vector3[][] = [];
  for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < 3; k++) dense.push(lerpRing(rings[r], rings[r + 1], k / 3));
  dense.push(rings[rings.length - 1]);
  for (let r = 0; r < dense.length - 1; r++)
    for (let i = 0; i < 6; i++) {
      const a = dense[r][i], b = dense[r][(i + 1) % 6], c = dense[r + 1][i], d = dense[r + 1][(i + 1) % 6];
      tri(a, c, b); tri(b, c, d);
    }
  const V = (y: number, z: number) => new THREE.Vector3(0, y, z);
  const both = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => { tri(a, b, c, finC); tri(a, c, b, finC); };
  const ts = Math.max(H, 0.14 * L) * 1.2;
  const tail = f.tail ?? 'fork';
  if (tail === 'fork') { both(V(0, 0.34 * L), V(ts, 0.6 * L), V(0.05 * L, 0.5 * L)); both(V(0, 0.34 * L), V(0.05 * L, 0.5 * L), V(-ts, 0.6 * L)); }
  else if (tail === 'lunate') { both(V(0, 0.34 * L), V(ts * 1.3, 0.62 * L), V(0, 0.45 * L)); both(V(0, 0.34 * L), V(0, 0.45 * L), V(-ts * 1.3, 0.62 * L)); }
  else { both(V(ts * 0.7, 0.55 * L), V(-ts * 0.7, 0.55 * L), V(0, 0.33 * L)); both(V(ts * 0.7, 0.55 * L), V(0, 0.6 * L), V(-ts * 0.7, 0.55 * L)); }
  const dh = (f.dorsal ?? 0.12) * L;
  both(V(H * 0.9, -0.15 * L), V(H + dh, 0.02 * L), V(H * 0.6, 0.2 * L));
  if (f.height > 0.3) both(V(-H * 0.9, -0.05 * L), V(-H - dh * 0.8, 0.08 * L), V(-H * 0.6, 0.22 * L)); // anal fin on disc fish
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** great white: torpedo body, tall dorsal, pectorals, crescent tail, white underside, dark eye */
function sharkGeometry() {
  const L = 5.0;
  const pos: number[] = [], col: number[] = [];
  const top = new THREE.Color(0x4a525a), belly = new THREE.Color(0xe8e8e4), finC = new THREE.Color(0x3c434a);
  const ring = (z: number, w: number, h: number, yOff = 0) =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const a = (i / 8) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * w, Math.sin(a) * h + yOff, z);
    });
  const rings = [
    ring(-0.5 * L, 0.02, 0.02, -0.02),
    ring(-0.44 * L, 0.18, 0.16, -0.03),
    ring(-0.3 * L, 0.36, 0.36),
    ring(-0.08 * L, 0.46, 0.5),
    ring(0.15 * L, 0.36, 0.4),
    ring(0.32 * L, 0.18, 0.2, 0.03),
    ring(0.42 * L, 0.07, 0.09, 0.05),
  ];
  const colorAt = (v: THREE.Vector3) => {
    // countershading with a sharp-ish boundary like the real thing
    const t = THREE.MathUtils.smoothstep(v.y, -0.12, 0.02);
    return belly.clone().lerp(top, t);
  };
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, fixed?: THREE.Color) => {
    for (const v of [a, b, c]) {
      pos.push(v.x, v.y, v.z);
      const cc = fixed ?? colorAt(v);
      col.push(cc.r, cc.g, cc.b);
    }
  };
  for (let r = 0; r < rings.length - 1; r++)
    for (let i = 0; i < 8; i++) {
      const a = rings[r][i], b = rings[r][(i + 1) % 8], c = rings[r + 1][i], d = rings[r + 1][(i + 1) % 8];
      tri(a, c, b); tri(b, c, d);
    }
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z * L);
  const both = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, k = finC) => { tri(a, b, c, k); tri(a, c, b, k); };
  // dorsal fin
  both(V(0, 0.45, -0.12), V(0, 1.25, 0.02), V(0, 0.4, 0.1));
  // pectoral fins
  for (const s of [-1, 1]) both(V(s * 0.38, -0.2, -0.22), V(s * 1.35, -0.55, 0.0), V(s * 0.36, -0.22, -0.05));
  // crescent tail (upper lobe longer)
  both(V(0, 0.05, 0.4), V(0, 1.0, 0.62), V(0, 0.08, 0.5));
  both(V(0, 0.02, 0.4), V(0, -0.7, 0.56), V(0, 0.08, 0.5));
  // small second dorsal / anal fins
  both(V(0, 0.2, 0.3), V(0, 0.38, 0.36), V(0, 0.15, 0.36));
  both(V(0, -0.18, 0.28), V(0, -0.35, 0.34), V(0, -0.12, 0.35));
  // eyes + gill slits (dark)
  const dark = new THREE.Color(0x0a0a0c);
  for (const s of [-1, 1]) {
    both(V(s * 0.3, 0.12, -0.36), V(s * 0.3, 0.17, -0.35), V(s * 0.31, 0.12, -0.34), dark);
    for (let k = 0; k < 4; k++) both(V(s * 0.43, 0.15, -0.24 + k * 0.025), V(s * 0.45, -0.15, -0.24 + k * 0.025), V(s * 0.45, -0.15, -0.235 + k * 0.025), dark);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

interface School {
  mesh: THREE.InstancedMesh;
  center: THREE.Vector3;
  heading: number;
  pitch: number;
  speed: number;
  radius: number;
  offsets: THREE.Vector3[];
  scatter: number;
  turn: number;
  /** per-fish boid state (xyz interleaved) */
  pos: Float32Array;
  vel: Float32Array;
  /** smoothed per-fish bank angle */
  roll: Float32Array;
  nextTurn: number;
}

interface Shark {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  retarget: number;
}

interface Species extends FishShape { name: string; count: number; radius: number; speed: number; schools: number }

/** fish are drawn larger than life so schools read well through the underwater haze */
const FISH_SCALE = 2.4;
/** deepest wave trough is ≈ -2.9 m; keep every animal below it */
const MAX_FISH_Y = -3.6;

const SPECIES_RAW: Species[] = [
  { name: 'Sardine', len: 0.3, height: 0.13, width: 0.5, back: 0x2a4a72, belly: 0xe4ecf2, lateral: 0x8aa8c0, count: 260, radius: 5, speed: 2.0, schools: 3 },
  { name: 'Makrele', len: 0.5, height: 0.13, width: 0.55, back: 0x2c5a48, belly: 0xeae6c8, stripes: { color: 0x14281e, count: 9, width: 0.12 }, count: 110, radius: 7, speed: 2.6, schools: 2 },
  { name: 'Thun', len: 1.4, height: 0.2, width: 0.65, back: 0x10285a, belly: 0xe8eaf0, lateral: 0xd0b030, tail: 'lunate', dorsal: 0.1, count: 24, radius: 8, speed: 3.6, schools: 1 },
  { name: 'Barrakuda', len: 1.3, height: 0.09, width: 0.6, back: 0x5a6670, belly: 0xdce2e6, stripes: { color: 0x3a444c, count: 14, width: 0.1 }, snout: 1, count: 18, radius: 6, speed: 1.6, schools: 1 },
  { name: 'Doktorfisch', len: 0.3, height: 0.36, width: 0.3, back: 0x1a3ad0, belly: 0x2a60e0, fin: 0xf0d020, tail: 'round', dorsal: 0.08, count: 50, radius: 5, speed: 1.3, schools: 1 },
  { name: 'Clownfisch', len: 0.12, height: 0.24, width: 0.45, back: 0xff6a10, belly: 0xff8a30, fin: 0x1a1a1a, stripes: { color: 0xf8f8f8, count: 3, width: 0.12 }, tail: 'round', count: 30, radius: 3, speed: 0.9, schools: 1 },
  { name: 'Kaiserfisch', len: 0.35, height: 0.45, width: 0.25, back: 0xf0d020, belly: 0xf8e060, fin: 0x202020, stripes: { color: 0x181818, count: 5, width: 0.1 }, tail: 'round', dorsal: 0.25, count: 16, radius: 5, speed: 1.0, schools: 1 },
  { name: 'Schnapper', len: 0.6, height: 0.24, width: 0.5, back: 0xc02828, belly: 0xf0a090, count: 40, radius: 6, speed: 1.8, schools: 1 },
  { name: 'Zackenbarsch', len: 1.1, height: 0.25, width: 0.6, back: 0x5a4632, belly: 0xa08a6a, stripes: { color: 0x3a2a1c, count: 6, width: 0.15 }, tail: 'round', count: 5, radius: 9, speed: 0.8, schools: 1 },
];

const SPECIES: Species[] = SPECIES_RAW.map((sp) => ({ ...sp, len: sp.len * FISH_SCALE, radius: sp.radius * Math.sqrt(FISH_SCALE) }));

export class MarineLife {
  readonly group = new THREE.Group();
  private schools: School[] = [];
  private sharks: Shark[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);

  constructor(env: THREE.Texture) {
    let k = 0;
    for (const sp of SPECIES)
      for (let n = 0; n < sp.schools; n++, k++) {
        const geo = withPhase(fishGeometry(sp), sp.count);
        const mat = swimMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.25 }, sp.len, 12 / Math.sqrt(sp.len), sp.len * 0.13, env);
        const mesh = new THREE.InstancedMesh(geo, mat, sp.count);
        mesh.frustumCulled = false;
        const offsets: THREE.Vector3[] = [];
        for (let i = 0; i < sp.count; i++) {
          const r = Math.pow(Math.random(), 0.6) * sp.radius;
          const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
          // school is elongated along the travel direction (local z)
          offsets.push(new THREE.Vector3(Math.cos(a) * Math.cos(b) * r, Math.sin(b) * r * 0.45, Math.sin(a) * Math.cos(b) * r * 1.6));
          mesh.setColorAt(i, new THREE.Color().setHSL(0, 0, 0.85 + Math.random() * 0.3));
        }
        this.group.add(mesh);
        const a = (k / 12) * Math.PI * 2, d = 14 + (k % 4) * 7;
        const sc: School = {
          mesh, offsets, radius: sp.radius, speed: sp.speed,
          center: new THREE.Vector3(Math.cos(a) * d, -9 - Math.random() * 16, Math.sin(a) * d),
          heading: Math.random() * 6.28, pitch: 0, scatter: 0, turn: (Math.random() - 0.5) * 0.2,
          pos: new Float32Array(sp.count * 3), vel: new Float32Array(sp.count * 3), roll: new Float32Array(sp.count),
          nextTurn: 3 + Math.random() * 8,
        };
        // per-school bounding sphere (world space, mesh sits at origin) → renderer frustum-culls whole schools
        mesh.boundingSphere = new THREE.Sphere(sc.center.clone(), sp.radius * 3 + 4);
        mesh.frustumCulled = true;
        this.resetFish(sc);
        this.schools.push(sc);
      }
    const sharkGeo = withPhase(sharkGeometry(), 1);
    for (let k = 0; k < 2; k++) {
      const mat = swimMaterial({ vertexColors: true, roughness: 0.55 }, 5, 3.2, 0.42, env);
      const mesh = new THREE.Mesh(sharkGeo, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      const p = new THREE.Vector3((Math.random() - 0.5) * 80, -10, (Math.random() - 0.5) * 80);
      this.sharks.push({ mesh, pos: p, vel: new THREE.Vector3(0, 0, -3), target: p.clone(), retarget: 0 });
    }
  }

  /** place every fish on its slot, moving with the school */
  private resetFish(sc: School) {
    const ch = Math.cos(sc.heading), sh = Math.sin(sc.heading);
    for (let i = 0; i < sc.offsets.length; i++) {
      const o = sc.offsets[i], j = i * 3;
      sc.pos[j] = sc.center.x + o.x * ch + o.z * sh;
      sc.pos[j + 1] = Math.min(sc.center.y + o.y, MAX_FISH_Y);
      sc.pos[j + 2] = sc.center.z - o.x * sh + o.z * ch;
      sc.vel[j] = -sh * sc.speed; sc.vel[j + 1] = 0; sc.vel[j + 2] = -ch * sc.speed;
    }
  }

  /** floating origin moved: shift everything by (-dx, -dz) */
  shift(dx: number, dz: number) {
    for (const sc of this.schools) {
      sc.center.x -= dx; sc.center.z -= dz;
      for (let j = 0; j < sc.pos.length; j += 3) { sc.pos[j] -= dx; sc.pos[j + 2] -= dz; }
    }
    for (const sk of this.sharks) { sk.pos.x -= dx; sk.pos.z -= dz; sk.target.x -= dx; sk.target.z -= dz; }
  }

  /** focus: player vessel position (fish flee, sharks circle it); cam: keep life around the camera */
  update(dt: number, t: number, focus: THREE.Vector3, cam: THREE.Vector3) {
    dt = Math.min(dt, 0.05);
    timeU.value = t;
    for (const sc of this.schools) {
      // wander, keep in depth band, stay within ~220 m of camera (respawn ahead if lost)
      sc.turn += (Math.random() - 0.5) * dt * 0.3;
      sc.nextTurn -= dt;
      if (sc.nextTurn <= 0) {
        // occasional decisive turn → the whole school sweeps around, fish follow with delay
        sc.turn = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6);
        sc.nextTurn = 4 + Math.random() * 10;
      }
      sc.turn *= Math.exp(-dt * 0.35);
      sc.heading += sc.turn * dt;
      const dx = sc.center.x - cam.x, dz = sc.center.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 80 * 80) {
        // lost: respawn 25–60 m from the camera
        for (let tries = 0; tries < 8; tries++) {
          const a = Math.random() * 6.28, r = 14 + Math.random() * 22;
          sc.center.set(cam.x + Math.cos(a) * r, -9 - Math.random() * 16, cam.z + Math.sin(a) * r);
          if (terrainHeight(sc.center.x, sc.center.z) < sc.center.y - 6) break; // open water only
        }
        this.resetFish(sc);
      } else if (d2 > 38 * 38) {
        // drift back toward the camera so schools stay in view
        const back = Math.atan2(dx, dz);
        let diff = back - sc.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        sc.heading += diff * dt * 0.9;
      }
      // steer away from shallows / islands ahead
      const ax = sc.center.x - Math.sin(sc.heading) * 15, az = sc.center.z - Math.cos(sc.heading) * 15;
      if (terrainHeight(ax, az) > sc.center.y - 4) sc.heading += dt * 1.5;
      const floor = terrainHeight(sc.center.x, sc.center.z);
      if (sc.center.y < floor + 3) sc.center.y = floor + 3;
      // flee from the vessel
      const fx = sc.center.x - focus.x, fy = sc.center.y - focus.y, fz = sc.center.z - focus.z;
      const fd = Math.sqrt(fx * fx + fy * fy + fz * fz);
      const threat = THREE.MathUtils.clamp(1 - (fd - sc.radius) / 12, 0, 1);
      if (threat > 0) {
        const away = Math.atan2(-fx, -fz);
        let diff = away - sc.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        sc.heading += diff * dt * 1.2 * threat;
      }
      sc.scatter = THREE.MathUtils.damp(sc.scatter, threat, 3, dt);
      const tgtDepth = THREE.MathUtils.clamp(sc.center.y, -28, -8);
      sc.pitch = THREE.MathUtils.damp(sc.pitch, (tgtDepth - sc.center.y) * 0.1 + Math.sin(t * 0.1 + sc.radius) * 0.15, 1, dt);
      const spd = sc.speed * (1 + sc.scatter * 1.8);
      sc.center.x += -Math.sin(sc.heading) * Math.cos(sc.pitch) * spd * dt;
      sc.center.z += -Math.cos(sc.heading) * Math.cos(sc.pitch) * spd * dt;
      sc.center.y += Math.sin(sc.pitch) * spd * dt;

      const spread = 1 + sc.scatter * 0.6;
      const checkTerrain = nearTerrain(sc.center.x, sc.center.z, sc.radius * 3 * spread + 5);
      const ch = Math.cos(sc.heading), sh = Math.sin(sc.heading);
      const svx = -sh * Math.cos(sc.pitch) * spd, svy = Math.sin(sc.pitch) * spd, svz = -ch * Math.cos(sc.pitch) * spd;
      const n = sc.offsets.length, P = sc.pos, Vl = sc.vel;
      const sepR = sc.radius * 0.22 + 0.3, sepR2 = sepR * sepR;
      const vMax = spd * 2.2, vMin = sc.speed * 0.35;
      const kSlot = 0.9, kAlign = 2.2;
      const bs = sc.mesh.boundingSphere!;
      bs.center.copy(sc.center); bs.radius = sc.radius * 3 * spread + 6;
      for (let i = 0; i < n; i++) {
        const o = sc.offsets[i], j = i * 3;
        // slot in the school frame, slowly breathing/morphing so the shape is never rigid
        const w = t * 0.3 + i * 0.37;
        const ox = o.x * (1 + Math.sin(w * 0.5) * 0.25);
        const oy = o.y + Math.sin(w + i) * 0.4;
        const oz = o.z * (1 + Math.sin(w * 0.35 + 1.7) * 0.2);
        const tx = sc.center.x + (ox * ch + oz * sh) * spread;
        const ty = sc.center.y + oy * spread;
        const tz = sc.center.z + (-ox * sh + oz * ch) * spread;
        let px = P[j], py = P[j + 1], pz = P[j + 2];
        let vx = Vl[j], vy = Vl[j + 1], vz = Vl[j + 2];
        // desired: school velocity (alignment) + spring toward slot (cohesion)
        let dx = svx + (tx - px) * kSlot, dy = svy + (ty - py) * kSlot, dz = svz + (tz - pz) * kSlot;
        // separation against a few index-neighbours (cheap stand-in for a neighbour search)
        for (const step of [1, 5, 17]) {
          const k = ((i + step) % n) * 3;
          const qx = px - P[k], qy = py - P[k + 1], qz = pz - P[k + 2];
          const d2 = qx * qx + qy * qy + qz * qz;
          if (d2 < sepR2 && d2 > 1e-6) { const f = (sepR2 / d2 - 1) * 0.6; dx += qx * f; dy += qy * f; dz += qz * f; }
        }
        // individual flight from the vessel → school bursts open like a fountain
        if (sc.scatter > 0.05) {
          const fx = px - focus.x, fy = py - focus.y, fz = pz - focus.z;
          const fd = Math.sqrt(fx * fx + fy * fy + fz * fz) + 0.5;
          const f = sc.scatter * spd * 2.5 / fd;
          dx += fx * f; dy += fy * f * 0.5; dz += fz * f;
        }
        const a = 1 - Math.exp(-dt * kAlign);
        vx += (dx - vx) * a; vy += (dy - vy) * a; vz += (dz - vz) * a;
        vy *= 0.92; // fish swim mostly level
        let sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (sp > vMax) { const f = vMax / sp; vx *= f; vy *= f; vz *= f; sp = vMax; }
        else if (sp < vMin) { const f = vMin / (sp + 1e-6); vx *= f; vy *= f; vz *= f; sp = vMin; }
        px += vx * dt; py += vy * dt; pz += vz * dt;
        // never above the deepest wave trough (≈ -2.9 m) → no fish in the air
        if (py > MAX_FISH_Y) { py = MAX_FISH_Y; if (vy > 0) vy = -vy * 0.3; }
        // stay out of the terrain: keep ≥ 1 m above the seabed; too shallow → hide
        const floor = (checkTerrain ? terrainHeight(px, pz) : SEABED) + 1.0;
        let hidden = false;
        if (floor > MAX_FISH_Y) hidden = true;
        else if (py < floor) { py = floor; if (vy < 0) vy = 0; }
        P[j] = px; P[j + 1] = py; P[j + 2] = pz; Vl[j] = vx; Vl[j + 1] = vy; Vl[j + 2] = vz;
        if (hidden) { this.m.makeScale(0, 0, 0); sc.mesh.setMatrixAt(i, this.m); continue; }
        // orientation from velocity; bank into turns (lateral accel vs. heading)
        const hd = Math.atan2(-vx, -vz);
        const pt = Math.asin(THREE.MathUtils.clamp(vy / sp, -0.8, 0.8));
        const lat = ((dx - vx) * Math.cos(hd) - (dz - vz) * Math.sin(hd)) / (sp + 0.5);
        sc.roll[i] = THREE.MathUtils.damp(sc.roll[i], THREE.MathUtils.clamp(-lat * 0.5, -0.7, 0.7), 4, dt);
        this.e.set(pt, hd, sc.roll[i]);
        this.q.setFromEuler(this.e);
        this.v.set(px, py, pz);
        this.m.compose(this.v, this.q, this.s);
        sc.mesh.setMatrixAt(i, this.m);
      }
      sc.mesh.instanceMatrix.needsUpdate = true;
    }

    for (const sk of this.sharks) {
      sk.retarget -= dt;
      if (sk.retarget <= 0 || sk.pos.distanceTo(sk.target) < 6) {
        // patrol a loose circle around the vessel, below the surface
        const a = Math.random() * 6.28, r = 18 + Math.random() * 45;
        sk.target.set(focus.x + Math.cos(a) * r, -6 - Math.random() * 18, focus.z + Math.sin(a) * r);
        const tf = terrainHeight(sk.target.x, sk.target.z);
        if (tf > sk.target.y - 4) { sk.target.copy(sk.pos); sk.retarget = 0.5; } // shallow → pick again soon
        sk.retarget = 8 + Math.random() * 10;
      }
      const desired = this.v.copy(sk.target).sub(sk.pos).normalize().multiplyScalar(3.2);
      sk.vel.lerp(desired, 1 - Math.exp(-dt * 0.5));
      sk.pos.addScaledVector(sk.vel, dt);
      // never into the seabed / island slopes: back out if the water gets too shallow
      const sf = terrainHeight(sk.pos.x, sk.pos.z) + 2.5;
      const shallow = sf > MAX_FISH_Y - 1;
      if (shallow) {
        // swim downhill (toward deeper water) and stay hidden until there is room
        const gx = terrainHeight(sk.pos.x + 2, sk.pos.z) - terrainHeight(sk.pos.x - 2, sk.pos.z);
        const gz = terrainHeight(sk.pos.x, sk.pos.z + 2) - terrainHeight(sk.pos.x, sk.pos.z - 2);
        const gl = Math.hypot(gx, gz) || 1;
        sk.vel.set(-gx / gl * 4, 0, -gz / gl * 4);
        sk.pos.addScaledVector(sk.vel, dt * 2);
        sk.retarget = 0;
      }
      sk.mesh.visible = !shallow;
      sk.pos.y = Math.max(Math.min(sk.pos.y, MAX_FISH_Y - 1), Math.min(sf, MAX_FISH_Y - 1));
      const h = Math.atan2(-sk.vel.x, -sk.vel.z);
      const p = Math.atan2(sk.vel.y, Math.hypot(sk.vel.x, sk.vel.z));
      sk.mesh.position.copy(sk.pos);
      sk.mesh.rotation.set(p, h, 0, 'YXZ');
    }
  }
}
