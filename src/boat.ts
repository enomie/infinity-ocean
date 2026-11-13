import * as THREE from 'three';
import { waveHeight } from './waves';
import { terrainHeight } from './world/terrain';
import type { VesselSpec } from './vessels/types';
import { buildScrew } from './vessels/hull';

/** wind blows toward this direction (xz) */
export const WIND_TO = new THREE.Vector2(1, 0.25).normalize();

export class Vessel {
  readonly group: THREE.Group;
  heading = 0.4;
  speed = 0;
  throttle = 0;
  rudder = 0;
  heave = 0;
  depth = 0; // submarine: metres below the surfaced trim
  private vDepth = 0;
  /** 0..1 how strongly the hull still disturbs the surface */
  surfaceContact = 1;
  readonly pos = new THREE.Vector2(0, 0);
  private y = 0; private vy = 0;
  private pitch = 0; private vp = 0;
  private roll = 0; private vr = 0;
  private sails?: THREE.Object3D;
  readonly screws: THREE.Object3D[] = [];
  /** shaft rpm in rad/s (follows throttle with inertia) */
  screwSpin = 0;

  constructor(readonly spec: VesselSpec, env: THREE.Texture) {
    this.group = spec.build(env);
    this.sails = this.group.getObjectByName('sails');
    const sc = spec.screws;
    sc.x.slice(0, 3).forEach((x, i) => {
      const m = buildScrew(env, sc.r, sc.blades ?? 4);
      // counter-rotating pairs: mirror the outer screws
      if (sc.x.length > 1 && x < 0) m.scale.x = -1;
      m.position.set(x, sc.y, sc.z);
      m.userData.dir = sc.x.length > 1 && x < 0 ? -1 : 1;
      m.name = 'screw' + i;
      this.group.add(m);
      this.screws.push(m);
    });
  }

  get forward() {
    return new THREE.Vector2(-Math.sin(this.heading), -Math.cos(this.heading));
  }

  /** 0..1 sailing efficiency for current heading */
  private sailPolar() {
    const f = this.forward;
    const ang = Math.acos(THREE.MathUtils.clamp(f.dot(WIND_TO), -1, 1)); // 0 = downwind, PI = into wind
    if (ang > Math.PI - 0.6) return 0; // in irons
    return 0.55 + 0.45 * Math.sin(Math.min(ang * 1.15, Math.PI - 0.01));
  }

  update(dt: number, t: number, keys: Set<string>, cam: THREE.Vector2) {
    dt = Math.min(dt, 0.05);
    const s = this.spec;
    const sub = !!s.submarine;
    const up = keys.has('KeyW') || (!sub && keys.has('ArrowUp'));
    const dn = keys.has('KeyS') || (!sub && keys.has('ArrowDown'));
    const lf = keys.has('KeyA') || keys.has('ArrowLeft');
    const rt = keys.has('KeyD') || keys.has('ArrowRight');
    this.throttle = THREE.MathUtils.damp(this.throttle, up ? 1 : dn ? -s.reverse : 0, 2.5, dt);
    this.rudder = THREE.MathUtils.damp(this.rudder, lf ? 1 : rt ? -1 : 0, 4, dt);

    let target = this.throttle * s.maxSpeed;
    if (s.sail) target = Math.max(this.throttle, 0) * s.maxSpeed * this.sailPolar();
    this.speed += (target - this.speed) * Math.min(dt * s.accel, 1);

    const steer = THREE.MathUtils.clamp(Math.abs(this.speed) / s.turnMinSpeed, 0.15, 1);
    this.heading += this.rudder * dt * s.turnRate * steer * Math.sign(this.speed || 1);
    // move, but run aground on islands: probe bow (or stern when reversing)
    const f = this.forward;
    const probe = Math.sign(this.speed || 1) * s.len * 0.45;
    const nx = this.pos.x + f.x * this.speed * dt, nz = this.pos.y + f.y * this.speed * dt;
    const keel = s.submarine ? -(this.depth + 6) : -Math.max(0.6, s.beam * 0.12);
    if (terrainHeight(nx + f.x * probe, nz + f.y * probe) > keel || terrainHeight(nx, nz) > keel) {
      this.speed *= -0.25; // bump off
    } else {
      this.pos.set(nx, nz);
    }

    // buoyancy samples scale with hull size → big ships average out short waves
    const c = Math.cos(this.heading), sn = Math.sin(this.heading);
    const sample = (lx: number, lz: number) =>
      waveHeight(this.pos.x + lx * c + lz * sn, this.pos.y - lx * sn + lz * c, t, cam);
    const L = s.len * 0.4, B = s.beam * 0.45;
    const hb = sample(0, -L), hs = sample(0, L), hp = sample(-B, 0), hst = sample(B, 0), hc = sample(0, 0);
    const hb2 = sample(0, -L * 0.5), hs2 = sample(0, L * 0.5);
    const sp = Math.abs(this.speed);
    const plane = s.planing ? THREE.MathUtils.smoothstep(sp, 6, 16) : 0;
    const hump = s.planing ? Math.exp(-Math.pow((sp - 8) / 4, 2)) * 0.12 : 0;

    let targetY = (hb + hs + hp + hst + hb2 + hs2 + hc * 2) / 8 - 0.12 - sp * 0.01 + plane * 0.25;
    let targetP = Math.atan2((hb + hb2) - (hs + hs2), L * 3) + this.speed * s.squat + hump;
    let targetR = Math.atan2(hst - hp, B * 2) + this.rudder * this.speed * s.turnHeel;
    if (s.sail) {
      // heel to leeward, proportional to drive
      const side = Math.sign(this.forward.x * WIND_TO.y - this.forward.y * WIND_TO.x) || 1;
      targetR += side * 0.28 * Math.max(this.throttle, 0) * this.sailPolar();
    }
    if (plane > 0) targetP *= 1 - plane * 0.6; // planing hull skims, follows waves less

    const spring = (x: number, v: number, tgt: number, k: number, d: number): [number, number] => {
      v += ((tgt - x) * k - v * d) * dt;
      return [x + v * dt, v];
    };
    if (sub) {
      // ↓ dive, ↑ surface; vertical rate grows with forward speed (dive planes)
      const dive = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
      const rate = 1.2 + Math.min(sp, 12) * 0.35;
      this.vDepth = THREE.MathUtils.damp(this.vDepth, dive * rate, 1.2, dt);
      this.depth = THREE.MathUtils.clamp(this.depth + this.vDepth * dt, 0, 250);
      if (this.depth === 0 && this.vDepth < 0) this.vDepth = 0;
      const surf = Math.exp(-this.depth / 6);
      this.surfaceContact = surf;
      // nose follows the vertical motion, waves only matter near the surface
      targetP = targetP * surf - Math.atan2(this.vDepth, Math.max(sp, 3)) * 0.9;
      targetR *= surf;
      targetY = targetY * surf - this.depth;
    }
    const prevY = this.y;
    [this.y, this.vy] = spring(this.y, this.vy, targetY, s.heave, s.damping);
    [this.pitch, this.vp] = spring(this.pitch, this.vp, targetP, s.heave * 1.15, s.damping * 1.2);
    [this.roll, this.vr] = spring(this.roll, this.vr, targetR, s.rollStiff, s.rollDamp);
    this.heave = THREE.MathUtils.clamp((this.y - prevY) / dt, -1, 1) * 0.15;

    if (this.sails) {
      // boom swings out to leeward depending on wind angle
      const rel = Math.atan2(WIND_TO.x, WIND_TO.y) - Math.atan2(this.forward.x, this.forward.y);
      const a = Math.atan2(Math.sin(rel), Math.cos(rel));
      this.sails.rotation.y = THREE.MathUtils.damp(this.sails.rotation.y, -a * 0.45, 2, dt);
    }

    // screws: rpm follows the throttle (motor), big screws turn slower; sail drive idles under sail
    const maxW = 30 / Math.sqrt(Math.max(s.screws.r, 0.1));
    const drive = s.sail ? this.throttle * 0.15 : this.throttle;
    this.screwSpin = THREE.MathUtils.damp(this.screwSpin, drive * maxW, 1.5, dt);
    for (const m of this.screws) m.rotation.z += this.screwSpin * dt * m.userData.dir;
    this.group.position.set(this.pos.x, this.y, this.pos.y);
    this.group.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
  }

  /** floating origin moved */
  shift(dx: number, dz: number) {
    this.pos.x -= dx;
    this.pos.y -= dz;
    this.group.position.x -= dx;
    this.group.position.z -= dz;
  }

  /** copy pose from previous vessel so switching keeps position */
  takeOver(o: Vessel) {
    this.pos.copy(o.pos);
    this.heading = o.heading;
    this.y = o.y;
  }
}
