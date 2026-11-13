import * as THREE from 'three';
import { waveHeight } from '../waves';
import type { Perch, World } from '../world';

/**
 * Seagulls: instanced low-poly birds with shader wing flapping.
 * Each gull runs a small state machine:
 *   fly (circle an anchor: nearby island or the player's vessel)
 *   → land (glide down to a beach perch or the water surface)
 *   → sit (wings folded; bobs on the waves when on water)
 *   → takeoff (hard flapping climb) → fly …
 */

const COUNT = 36;
const SCALE = 1.6; // a bit larger than life so they read at distance
const timeU = { value: 0 };

type State = 'fly' | 'land' | 'sit' | 'takeoff';
interface Gull {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  state: State;
  timer: number;
  orbitR: number;
  orbitAlt: number;
  orbitDir: number;
  ang: number;
  perch: Perch | null;
  onWater: boolean;
  bank: number;
  flock: number;
}

/** body + wings; attribute aPart: 0 body, 1 inner wing, 2 wing tip; aSide: ±1 */
function gullGeometry() {
  const pos: number[] = [], col: number[] = [], part: number[] = [], side: number[] = [];
  const white = new THREE.Color(0xf4f4f2), grey = new THREE.Color(0x9aa2aa), black = new THREE.Color(0x1a1a1a), beak = new THREE.Color(0xf0c020);
  const tri = (a: number[], b: number[], c: number[], k: THREE.Color, pt = 0, sd = 0) => {
    for (const v of [a, b, c]) { pos.push(v[0], v[1], v[2]); col.push(k.r, k.g, k.b); part.push(pt); side.push(sd); }
  };
  const both = (a: number[], b: number[], c: number[], k: THREE.Color, pt = 0, sd = 0) => { tri(a, b, c, k, pt, sd); tri(a, c, b, k, pt, sd); };
  // body: elongated diamond (head at -z)
  const nose = [0, 0.02, -0.32], tail = [0, 0.0, 0.28], top = [0, 0.08, -0.02], bot = [0, -0.07, 0.0], l = [-0.07, 0, -0.04], r = [0.07, 0, -0.04];
  for (const [a, b] of [[top, l], [l, bot], [bot, r], [r, top]]) { tri(nose, b, a, white); tri(tail, a, b, white); }
  // beak
  both([0, 0.02, -0.32], [0.015, 0.01, -0.4], [-0.015, 0.01, -0.4], beak);
  // tail fan
  both([0, 0.0, 0.2], [0.08, 0.0, 0.36], [-0.08, 0.0, 0.36], white);
  for (const sd of [-1, 1]) {
    const s = (x: number) => x * sd;
    // inner wing: shoulder (x 0.06) → elbow (x 0.42)
    both([s(0.06), 0.02, -0.1], [s(0.42), 0.02, -0.08], [s(0.06), 0.02, 0.08], grey, 1, sd);
    both([s(0.42), 0.02, -0.08], [s(0.42), 0.02, 0.06], [s(0.06), 0.02, 0.08], grey, 1, sd);
    // outer wing with black tip
    both([s(0.42), 0.02, -0.08], [s(0.78), 0.02, 0.02], [s(0.42), 0.02, 0.06], grey, 2, sd);
    both([s(0.66), 0.021, -0.01], [s(0.8), 0.021, 0.03], [s(0.62), 0.021, 0.04], black, 2, sd);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.computeVertexNormals();
  g.scale(SCALE, SCALE, SCALE);
  return g;
}

function gullMaterial(env: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true, envMap: env, envMapIntensity: 0.8 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBirdTime = timeU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uBirdTime;
        attribute float aPart, aSide;
        attribute vec3 aFlap; // amplitude, frequency, fold (0 open … 1 folded)
        attribute float aPhase;
        vec3 rotZ(vec3 p, vec3 pivot, float a){ p -= pivot; float c = cos(a), s = sin(a); return pivot + vec3(c*p.x - s*p.y, s*p.x + c*p.y, p.z); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aPart > 0.5) {
          float fold = aFlap.z;
          float beat = sin(uBirdTime * aFlap.y + aPhase);
          float a1 = (beat * aFlap.x + 0.12) * aSide;            // shoulder
          float a2 = (sin(uBirdTime * aFlap.y + aPhase - 0.8) * aFlap.x * 0.7) * aSide; // tip lags
          vec3 p = transformed;
          p.x *= mix(1.0, 0.22, fold);                        // folded wings lie along the body
          p.y += fold * 0.05 * ${SCALE.toFixed(2)};
          vec3 shoulder = vec3(0.06 * aSide * ${SCALE.toFixed(2)}, 0.02 * ${SCALE.toFixed(2)}, 0.0);
          vec3 elbow = vec3(0.42 * aSide * ${SCALE.toFixed(2)} * mix(1.0, 0.22, fold), 0.02 * ${SCALE.toFixed(2)}, 0.0);
          if (aPart > 1.5) p = rotZ(p, elbow, a2 * (1.0 - fold));
          transformed = rotZ(p, shoulder, a1 * (1.0 - fold));
        }`);
  };
  return m;
}

export class Gulls {
  readonly mesh: THREE.InstancedMesh;
  private gulls: Gull[] = [];
  private flap: THREE.InstancedBufferAttribute;
  private anchors: THREE.Vector3[] = [];
  private anchorPerches: (Perch[] | null)[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private one = new THREE.Vector3(1, 1, 1);
  private tmp = new THREE.Vector3();
  private dv = new THREE.Vector3();
  private anchorTimer = 0;

  constructor(env: THREE.Texture, private world: World) {
    const geo = gullGeometry();
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
    this.flap.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlap', this.flap);
    const ph = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) ph[i] = Math.random() * 6.28;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    this.mesh = new THREE.InstancedMesh(geo, gullMaterial(env), COUNT);
    this.mesh.frustumCulled = false;
    for (let f = 0; f < 3; f++) { this.anchors.push(new THREE.Vector3()); this.anchorPerches.push(null); }
    for (let i = 0; i < COUNT; i++) {
      this.gulls.push({
        pos: new THREE.Vector3((Math.random() - 0.5) * 60, 15 + Math.random() * 20, (Math.random() - 0.5) * 60),
        vel: new THREE.Vector3(1, 0, 0), state: 'fly', timer: 4 + Math.random() * 20,
        orbitR: 18 + Math.random() * 40, orbitAlt: 10 + Math.random() * 25, orbitDir: Math.random() < 0.5 ? -1 : 1,
        ang: Math.random() * 6.28, perch: null, onWater: false, bank: 0, flock: i % 3,
      });
    }
  }

  /** flocks hang around the nearest islands; one flock always follows the vessel */
  private pickAnchors(cam: THREE.Vector3, vessel: THREE.Vector3) {
    for (let f = 0; f < 3; f++) {
      if (f === 0) { this.anchors[f].set(vessel.x, 0, vessel.z); this.anchorPerches[f] = null; continue; }
      const it = this.world.nearestIsland(cam.x + (f === 1 ? 0 : 150), cam.z, 700);
      if (it) {
        this.anchors[f].set(it.x, 0, it.z);
        this.anchorPerches[f] = it.perches;
      } else {
        this.anchors[f].set(vessel.x, 0, vessel.z);
        this.anchorPerches[f] = null;
      }
    }
  }

  /** floating origin moved: shift everything by (-dx, -dz) */
  shift(dx: number, dz: number) {
    for (const g of this.gulls) {
      g.pos.x -= dx; g.pos.z -= dz;
      if (g.perch) g.perch = { x: g.perch.x - dx, y: g.perch.y, z: g.perch.z - dz };
    }
    for (const a of this.anchors) { a.x -= dx; a.z -= dz; }
    this.anchorTimer = 0;
  }

  update(dt: number, t: number, cam: THREE.Vector3, vessel: THREE.Vector3, camXZ: THREE.Vector2) {
    dt = Math.min(dt, 0.05);
    timeU.value = t;
    this.anchorTimer -= dt;
    if (this.anchorTimer <= 0) { this.pickAnchors(cam, vessel); this.anchorTimer = 3; }
    this.anchors[0].set(vessel.x, 0, vessel.z);

    for (let i = 0; i < COUNT; i++) {
      const g = this.gulls[i];
      const anchor = this.anchors[g.flock];
      let amp = 0, freq = 9, fold = 0, speed = 9;
      g.timer -= dt;

      if (g.state === 'fly') {
        // soaring circles with occasional flap bursts
        g.ang += (g.orbitDir * speed / g.orbitR) * dt;
        const isl = this.anchorPerches[g.flock];
        const r = isl ? g.orbitR * 2.5 : g.orbitR;
        this.tmp.set(anchor.x + Math.cos(g.ang) * r, g.orbitAlt + Math.sin(t * 0.3 + i) * 3, anchor.z + Math.sin(g.ang) * r);
        this.steer(g, this.tmp, speed, dt, 1.6);
        amp = Math.sin(t * 0.7 + i * 1.7) > 0.3 ? 0.55 : 0.05;
        if (g.timer <= 0) this.chooseLanding(g, anchor, i);
      } else if (g.state === 'land') {
        const p = g.perch!;
        const ty = g.onWater ? waveHeight(p.x, p.z, t, camXZ) + 0.05 : p.y + 0.05;
        this.tmp.set(p.x, ty, p.z);
        const d = g.pos.distanceTo(this.tmp);
        speed = THREE.MathUtils.clamp(d * 0.6, 2.5, 9);
        this.steer(g, this.tmp, speed, dt, 2.2);
        amp = d < 6 ? 0.9 : 0.1; freq = d < 6 ? 14 : 9; // flare before touchdown
        if (d < 0.6) { g.state = 'sit'; g.timer = 6 + Math.random() * 18; g.vel.multiplyScalar(0.05); }
        if (g.timer < -25) g.state = 'takeoff'; // give up
      } else if (g.state === 'sit') {
        const p = g.perch!;
        g.pos.set(p.x, g.onWater ? waveHeight(p.x, p.z, t, camXZ) + 0.04 : p.y + 0.05, p.z);
        fold = 1;
        if (g.timer <= 0 || this.tmp.set(vessel.x, g.pos.y, vessel.z).distanceTo(g.pos) < 10) {
          g.state = 'takeoff'; g.timer = 2.5;
          g.vel.set(Math.random() - 0.5, 1.5, Math.random() - 0.5).normalize().multiplyScalar(4);
        }
      } else {
        // takeoff: hard flapping climb
        amp = 1.0; freq = 15;
        g.vel.y = THREE.MathUtils.damp(g.vel.y, 4, 2, dt);
        g.vel.multiplyScalar(1 + dt * 0.4);
        if (g.vel.length() > 9) g.vel.setLength(9);
        g.pos.addScaledVector(g.vel, dt);
        if (g.timer <= 0) { g.state = 'fly'; g.timer = 10 + Math.random() * 25; g.perch = null; }
      }

      // keep the flock near the camera
      if (g.state === 'fly' && g.pos.distanceTo(cam) > 600) {
        g.pos.set(anchor.x + (Math.random() - 0.5) * 80, 25, anchor.z + (Math.random() - 0.5) * 80);
      }

      // orientation from velocity, bank into turns
      const v = g.vel;
      const hd = Math.atan2(-v.x, -v.z);
      const pitch = g.state === 'sit' ? 0 : Math.atan2(v.y, Math.hypot(v.x, v.z)) * 0.6;
      const desiredBank = g.state === 'fly' ? -g.orbitDir * 0.35 : 0;
      g.bank = THREE.MathUtils.damp(g.bank, desiredBank, 2, dt);
      this.e.set(pitch, hd, g.bank);
      this.q.setFromEuler(this.e);
      this.m.compose(g.pos, this.q, this.one);
      this.mesh.setMatrixAt(i, this.m);
      this.flap.setXYZ(i, amp, freq, fold);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flap.needsUpdate = true;
  }

  private steer(g: Gull, target: THREE.Vector3, speed: number, dt: number, agility: number) {
    const desired = this.dv.copy(target).sub(g.pos);
    const d = desired.length();
    if (d > 1e-3) desired.multiplyScalar(speed / d);
    g.vel.lerp(desired, 1 - Math.exp(-dt * agility));
    g.pos.addScaledVector(g.vel, dt);
  }

  private chooseLanding(g: Gull, anchor: THREE.Vector3, i: number) {
    const perches = this.anchorPerches[g.flock];
    if (perches && perches.length) {
      const p = perches[(i * 7 + Math.floor(Math.random() * perches.length)) % perches.length];
      g.perch = { x: p.x + (Math.random() - 0.5) * 3, y: p.y, z: p.z + (Math.random() - 0.5) * 3 }; // spread out
      g.onWater = false;
    } else {
      // settle on the water near the anchor (but not right on top of the vessel)
      const a = Math.random() * 6.28, r = 25 + Math.random() * 40;
      g.perch = { x: anchor.x + Math.cos(a) * r, y: 0, z: anchor.z + Math.sin(a) * r };
      g.onWater = true;
    }
    g.state = 'land';
    g.timer = 0;
  }
}
