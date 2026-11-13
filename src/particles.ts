import * as THREE from 'three';
import { SHARED_GLSL } from './ocean';
import type { Vessel } from './boat';
import { SUN_DIR } from './sky';

/**
 * Particles – 2 draw calls total:
 *  - `Drift`: camera-wrapped volume (one Points mesh). Below the surface plankton,
 *    marine snow and darting krill/shrimp; above it sparse sunlit salt haze.
 *  - `Spray`: CPU pool for bow spray, stern wash and slam bursts of the player vessel.
 */

const viewH = { value: 1080 };
/** call on resize / resolution change: drawing-buffer height in px */
export function setParticleViewport(h: number) { viewH.value = h; }

const BOX = 34; // m, wrapped volume around the camera
const DRIFT_N = 7000;

export function createDrift(shared: Record<string, THREE.IUniform>) {
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(DRIFT_N * 4);
  for (let i = 0; i < DRIFT_N * 4; i++) seed[i] = Math.random();
  // position attribute is unused (positions come from the seed) but three needs one for draw count
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DRIFT_N * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uViewH: viewH, uCam: { value: new THREE.Vector3() } },
    transparent: true,
    // must write depth: the underwater post pass fogs by depth buffer distance
    depthWrite: true,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      ${SHARED_GLSL}
      attribute vec4 aSeed;
      uniform float uViewH;
      uniform vec3 uCam;
      varying vec3 vCol;
      varying float vA;
      varying float vKind;
      const float B = ${BOX.toFixed(1)};
      void main(){
        float kind = aSeed.w; // <0.82 plankton/snow, else krill/shrimp
        bool krill = kind > 0.82;
        // slow drift + sinking marine snow; krill dart in short bursts
        vec3 drift = vec3(sin(uTime * 0.11 + aSeed.x * 40.0), -0.04 * uTime * (0.5 + aSeed.y), cos(uTime * 0.09 + aSeed.z * 40.0)) * 0.6;
        if (krill) {
          float k = uTime * (0.6 + aSeed.y * 0.5) + aSeed.x * 10.0;
          float burst = floor(k) + smoothstep(0.0, 0.25, fract(k)); // jerk forward, then hang
          vec3 dir = normalize(vec3(sin(aSeed.z * 6.28 + floor(k) * 0.7), 0.15 * sin(floor(k) * 1.3), cos(aSeed.z * 6.28 + floor(k) * 0.7)));
          drift += dir * burst * 0.35;
        }
        vec3 p = aSeed.xyz * B + drift;
        p = uCam + mod(p - uCam, B) - 0.5 * B;
        float surf = gerstnerHeight(p.xz);
        bool air = p.y > surf + 0.15;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float size;
        if (air) {
          // only a few motes survive above water: salt haze, glinting toward the sun
          bool keep = aSeed.w < 0.07 && p.y < surf + 12.0;
          vec3 V = normalize(p - cameraPosition);
          float fwdSc = pow(max(dot(V, uSunDir), 0.0), 6.0);
          vCol = vec3(1.0, 0.95, 0.85) * (0.04 + fwdSc * 0.5);
          size = keep ? 0.03 : 0.0;
          vKind = 0.0;
        } else if (krill) {
          vCol = mix(vec3(0.9, 0.42, 0.3), vec3(0.95, 0.75, 0.6), aSeed.y) * 0.4;
          size = 0.05 + aSeed.y * 0.07;
          vKind = 1.0;
        } else {
          vCol = vec3(0.55, 0.8, 0.75) * (0.12 + aSeed.y * 0.2);
          size = 0.012 + aSeed.x * aSeed.x * 0.04;
          vKind = 0.0;
        }
        // light from above: brighter near the surface, sun shafts flicker
        if (!air) vCol *= exp(p.y * 0.06) * (0.7 + 0.3 * sin(uTime * 0.7 + p.x * 0.3 + p.z * 0.2));
        // fade at the wrap border and very close to the lens
        vec3 rel = abs(p - uCam) / (0.5 * B);
        vA = (1.0 - smoothstep(0.75, 1.0, max(rel.x, max(rel.y, rel.z)))) * smoothstep(0.15, 0.6, d);
        float px = size * projectionMatrix[1][1] * 0.5 * uViewH / max(d, 0.05);
        // sub-pixel motes: keep 1.5 px, fade energy instead (no shimmer)
        vA *= min(px / 1.5, 1.0);
        gl_PointSize = size > 0.0 ? max(px, 1.5) : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vA;
      varying float vKind;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        // krill: elongated body with bright eye-dot; plankton: soft disc
        float r = vKind > 0.5 ? length(c * vec2(2.2, 1.0)) : length(c);
        float a = smoothstep(0.5, 0.15, r) * vA;
        if (a < 0.05) discard;
        vec3 col = vCol * (1.0 + 1.5 * smoothstep(0.2, 0.0, r));
        gl_FragColor = vec4(col * a, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return { mesh: pts, update(cam: THREE.Vector3) { mat.uniforms.uCam.value.copy(cam); } };
}

const SPRAY_N = 2400;

export class Spray {
  readonly mesh: THREE.Points;
  private pos = new Float32Array(SPRAY_N * 3);
  private vel = new Float32Array(SPRAY_N * 3);
  private life = new Float32Array(SPRAY_N * 2); // age, maxAge
  private size = new Float32Array(SPRAY_N);
  private head = 0;
  private acc = 0;
  private aPos: THREE.BufferAttribute;
  private aLife: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;

  constructor() {
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aLife = new THREE.BufferAttribute(this.life, 2).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aLife', this.aLife);
    g.setAttribute('aSize', this.aSize);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uViewH: viewH, uSun: { value: SUN_DIR } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec2 aLife;
        attribute float aSize; // > 0 droplet (sphere), < 0 mist puff
        uniform float uViewH;
        uniform vec3 uSun;
        varying float vA;
        varying float vMist;
        varying float vBack;
        varying vec3 vSunV;
        void main(){
          float t = aLife.x / max(aLife.y, 1e-3);
          vMist = aSize < 0.0 ? 1.0 : 0.0;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float s = abs(aSize) * (vMist > 0.5 ? 0.6 + t * 2.0 : 1.0);
          float px = s * projectionMatrix[1][1] * 0.5 * uViewH / max(-mv.z, 0.1);
          float fade = vMist > 0.5 ? smoothstep(0.0, 0.06, t) * (1.0 - t) * (1.0 - t) * 0.5 : 1.0 - smoothstep(0.85, 1.0, t);
          vA = (t < 1.0 && aSize != 0.0) ? fade * min(px / 2.0, 1.0) : 0.0;
          vec3 V = normalize(position - cameraPosition);
          vBack = pow(max(dot(V, uSun), 0.0), 8.0);
          vSunV = normalize((viewMatrix * vec4(uSun, 0.0)).xyz);
          gl_PointSize = vA > 0.0 ? max(px, 2.0) : 0.0;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying float vMist;
        varying float vBack;
        varying vec3 vSunV;
        void main(){
          vec2 c = (gl_PointCoord - 0.5) * 2.0;
          float r2 = dot(c, c);
          if (r2 > 1.0) discard;
          if (vMist > 0.5) {
            float a = (1.0 - r2) * (1.0 - r2) * vA;
            if (a < 0.004) discard;
            gl_FragColor = vec4(vec3(0.85, 0.9, 0.93) * (1.0 + vBack * 3.0), a);
            return;
          }
          // sphere impostor: view-space normal of a water droplet
          vec3 n = vec3(c.x, -c.y, sqrt(1.0 - r2));
          float ndl = dot(n, vSunV);
          float fres = pow(1.0 - n.z, 3.0);
          vec3 h = normalize(vSunV + vec3(0.0, 0.0, 1.0));
          float spec = pow(max(dot(n, h), 0.0), 60.0) * 6.0;
          // water is clear: dark-ish refracted core, bright sky rim, sharp sun glint, glow when backlit
          vec3 sky = vec3(0.62, 0.74, 0.86);
          vec3 col = mix(vec3(0.18, 0.34, 0.38), sky * 1.2, fres) + vec3(1.0, 0.96, 0.9) * spec
                   + vec3(0.9, 1.0, 1.0) * vBack * 2.5 * (1.0 - fres)
                   + vec3(0.25) * max(-ndl, 0.0) * (1.0 - n.z);  // caustic spot opposite the sun
          float edge = 1.0 - smoothstep(0.85, 1.0, r2);
          gl_FragColor = vec4(col, vA * mix(0.85, 1.0, fres) * edge);
        }`,
    });
    this.mesh = new THREE.Points(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  shift(dx: number, dz: number) {
    for (let j = 0; j < this.pos.length; j += 3) { this.pos[j] -= dx; this.pos[j + 2] -= dz; }
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number) {
    const i = this.head; this.head = (this.head + 1) % SPRAY_N;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.life[i * 2] = 0; this.life[i * 2 + 1] = life;
    this.size[i] = size;
  }

  /** 75 % droplets (spheres, 2–9 cm × scale), 25 % mist puffs (negative size) */
  private dropSize(scale: number) {
    return Math.random() < 0.75 ? (0.02 + Math.random() ** 2 * 0.07) * scale : -(0.12 + Math.random() * 0.2) * scale;
  }

  update(dt: number, boat: Vessel, bubbles?: Bubbles) {
    dt = Math.min(dt, 0.05);
    const s = boat.spec, v = Math.abs(boat.speed);
    const f = boat.forward, rx = -f.y, rz = f.x; // right = (-fz, fx) in xz
    const by = boat.group.position.y;
    const contact = boat.surfaceContact;
    const scale = Math.sqrt(s.beam / 2.9);
    // emission budget this frame
    const bowRate = contact * Math.max(0, v - 1.5) ** 1.4 * 60 * scale;
    const sternRate = contact * Math.abs(boat.throttle) * Math.max(0, v - 0.5) * 18 * scale;
    const slam = boat.heave < -0.05 ? (-boat.heave - 0.05) * 3000 * scale * contact : 0;
    this.acc += (bowRate + sternRate + slam) * dt;
    const total = bowRate + sternRate + slam || 1;
    while (this.acc >= 1) {
      this.acc -= 1;
      const pick = Math.random() * total;
      const side = Math.random() < 0.5 ? -1 : 1;
      if (pick < bowRate) {
        // bow sheets: thrown sideways + up from the shoulders of the bow
        const along = s.len * (0.22 + Math.random() * 0.2);
        const x = boat.pos.x + f.x * along + rx * side * s.beam * 0.42;
        const z = boat.pos.y + f.y * along + rz * side * s.beam * 0.42;
        const out = (0.8 + v * 0.22) * (0.4 + Math.random() * 0.8);
        const up = (0.6 + v * 0.25) * (0.3 + Math.random() * 0.9);
        this.emit(x, by - 0.1, z, rx * side * out + f.x * v * 0.55, up, rz * side * out + f.y * v * 0.55,
          0.6 + Math.random() * 0.9, this.dropSize(scale));
      } else if (pick < bowRate + sternRate) {
        // stern wash: churned droplets behind the transom
        const x = boat.pos.x - f.x * s.len * 0.5 + rx * (Math.random() - 0.5) * s.beam * 0.6;
        const z = boat.pos.y - f.y * s.len * 0.5 + rz * (Math.random() - 0.5) * s.beam * 0.6;
        this.emit(x, by + 0.05, z, (Math.random() - 0.5) * 1.2 - f.x * 0.5, 0.4 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2 - f.y * 0.5,
          0.4 + Math.random() * 0.6, this.dropSize(scale));
      } else {
        // slam: hull drops into a trough → wide splash ring around the forward hull
        const along = s.len * (Math.random() * 0.45);
        const x = boat.pos.x + f.x * along + rx * side * s.beam * 0.5;
        const z = boat.pos.y + f.y * along + rz * side * s.beam * 0.5;
        const out = 1.5 + Math.random() * 2.5;
        this.emit(x, by - 0.1, z, rx * side * out + f.x * v * 0.5, 1.5 + Math.random() * 3.0, rz * side * out + f.y * v * 0.5,
          0.6 + Math.random() * 0.9, this.dropSize(scale * 1.3));
      }
    }
    // integrate: gravity + air drag; die when back below the hull waterline
    const drag = Math.exp(-dt * 1.4);
    for (let i = 0; i < SPRAY_N; i++) {
      const L = i * 2;
      if (this.life[L] >= this.life[L + 1]) continue;
      this.life[L] += dt;
      const j = i * 3;
      this.vel[j] *= drag; this.vel[j + 2] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag - 9.81 * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < by - 0.25 && this.vel[j + 1] < 0) {
        // impact: droplet hits the water hard → small re-splash + entrained bubbles
        this.life[L] = this.life[L + 1];
        const sz = this.size[i], vy = -this.vel[j + 1];
        if (sz > 0.03 && vy > 2 && Math.random() < 0.45) {
          for (let k = 0; k < 2; k++) {
            const a = Math.random() * 6.28, h = Math.min(vy * 0.35, 2.5) * (0.5 + Math.random() * 0.5);
            this.emit(this.pos[j], by - 0.2, this.pos[j + 2], Math.cos(a) * h * 0.4, h, Math.sin(a) * h * 0.4, 0.4, sz * 0.55);
          }
        }
        if (bubbles && sz !== 0 && Math.random() < 0.6)
          bubbles.spawn(this.pos[j], by - 0.4 - Math.random() * 0.5, this.pos[j + 2], this.vel[j] * 0.2, -vy * 0.15, this.vel[j + 2] * 0.2,
            0.8 + Math.random(), 0.01 + Math.random() * 0.025, 0);
      }
    }
    this.aPos.needsUpdate = true; this.aLife.needsUpdate = true; this.aSize.needsUpdate = true;
  }
}

const BUBBLE_N = 6000;

/**
 * Propeller bubbles: emitted on the blade circle of every screw, thrown aft by the
 * jet, swirling with the rotation, rising and wobbling. One Points draw call.
 */
export class Bubbles {
  readonly mesh: THREE.Points;
  private pos = new Float32Array(BUBBLE_N * 3);
  private vel = new Float32Array(BUBBLE_N * 3);
  private life = new Float32Array(BUBBLE_N * 2);
  private size = new Float32Array(BUBBLE_N);
  private ph = new Float32Array(BUBBLE_N);
  private kind = new Float32Array(BUBBLE_N);
  private head = 0;
  private acc = 0;
  private attrs: THREE.BufferAttribute[];
  private w = new THREE.Vector3();
  private ax = new THREE.Vector3();
  private up = new THREE.Vector3();
  private side = new THREE.Vector3();

  constructor() {
    const g = new THREE.BufferGeometry();
    const a = (arr: Float32Array, n: number) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [a(this.pos, 3), a(this.life, 2), a(this.size, 1), a(this.kind, 1)];
    g.setAttribute('position', this.attrs[0]);
    g.setAttribute('aLife', this.attrs[1]);
    g.setAttribute('aSize', this.attrs[2]);
    g.setAttribute('aKind', this.attrs[3]);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uViewH: viewH },
      transparent: true,
      depthWrite: true, // underwater post pass fogs by depth
      vertexShader: /* glsl */ `
        attribute vec2 aLife;
        attribute float aSize;
        attribute float aKind;
        uniform float uViewH;
        varying float vA;
        varying float vKind;
        varying float vSeed;
        void main(){
          float t = aLife.x / max(aLife.y, 1e-3);
          vKind = aKind;
          vSeed = fract(aKind); // stable per particle (kind = 1 + seed)
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // bubbles grow slowly while rising; aerated puffs balloon and dissolve
          float s = aSize * (aKind > 0.5 ? 0.5 + t * 2.2 : 0.7 + t * 0.8);
          float px = s * projectionMatrix[1][1] * 0.5 * uViewH / max(-mv.z, 0.1);
          float fade = aKind > 0.5 ? smoothstep(0.0, 0.1, t) * (1.0 - t) * (1.0 - t) : smoothstep(0.0, 0.05, t) * (1.0 - t * t);
          vA = (t < 1.0 && aSize > 0.0) ? fade * min(px / 1.5, 1.0) * smoothstep(0.8, 2.5, -mv.z) : 0.0;
          gl_PointSize = (vA > 0.0 && aKind < 0.5) ? clamp(px, 1.5, 160.0) : 0.0;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying float vKind;
        varying float vSeed;
        void main(){
          vec2 c = (gl_PointCoord - 0.5) * 2.0;
          float r2 = dot(c, c);
          if (r2 > 1.0) discard;
          if (vKind > 0.5) {
            // aerated wash: lumpy white cloud (a few lobes), lit from above
            float ang = atan(c.y, c.x);
            float lobe = 0.9 + 0.1 * sin(ang * 3.0 + vSeed * 30.0);
            float d = sqrt(r2) / lobe;
            float core = 1.0 - smoothstep(0.0, 1.0, d);
            float a = core * 0.75 * vA;
            if (a < 0.01) discard;
            vec3 col = mix(vec3(0.55, 0.8, 0.9), vec3(0.95, 0.98, 1.0), 0.5 - c.y * 0.5);
            gl_FragColor = vec4(col, a);
            return;
          }
          // bubble sphere: air inside water → total internal reflection rim + top glint
          vec3 n = vec3(c.x, -c.y, sqrt(1.0 - r2));
          float rim = pow(1.0 - n.z, 2.5);
          float glint = pow(max(dot(n, normalize(vec3(-0.35, 0.7, 0.6))), 0.0), 40.0) * 3.0;
          float a = (rim * 0.85 + glint + 0.04) * vA;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vec3(0.75, 0.93, 0.97) * (0.7 + glint), min(a, 1.0));
        }`,
    });
    this.mesh = new THREE.Points(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    // aerated wash cloud: drawn AFTER the post pass (soft alpha would otherwise reveal unfogged
    // background, because post fogs by depth). Manual depth test + own fog + tonemap.
    this.cloud = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uViewH: viewH, tDepth: this.depthU, uRes: this.resU },
      transparent: true, depthTest: false, depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec2 aLife;
        attribute float aSize;
        attribute float aKind;
        uniform float uViewH;
        varying float vA;
        varying float vSeed;
        varying float vDist;
        varying float vY;
        void main(){
          float t = aLife.x / max(aLife.y, 1e-3);
          vSeed = fract(aKind);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          vDist = -mv.z; vY = position.y;
          float s = aSize * (0.5 + t * 2.2);
          float px = s * projectionMatrix[1][1] * 0.5 * uViewH / max(-mv.z, 0.1);
          vA = (t < 1.0 && aKind > 0.5) ? smoothstep(0.0, 0.1, t) * (1.0 - t) * (1.0 - t) * smoothstep(0.8, 2.5, -mv.z) : 0.0;
          gl_PointSize = vA > 0.0 ? clamp(px, 2.0, 220.0) : 0.0;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth;
        uniform vec2 uRes;
        varying float vA;
        varying float vSeed;
        varying float vDist;
        varying float vY;
        vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        void main(){
          if (gl_FragCoord.z > texture2D(tDepth, gl_FragCoord.xy / uRes).r) discard; // behind hull/terrain/surface
          vec2 c = (gl_PointCoord - 0.5) * 2.0;
          float ang = atan(c.y, c.x);
          float d = length(c) / (0.88 + 0.12 * sin(ang * 3.0 + vSeed * 30.0));
          float core = 1.0 - smoothstep(0.0, 1.0, d);
          float a = min(core * 0.85, 0.85) * vA;
          if (a < 0.004) discard;
          // white aerated water, lit from above, then the same water absorption/fog as post
          vec3 col = mix(vec3(0.5, 0.8, 0.85), vec3(1.6, 1.7, 1.7), 0.55 - c.y * 0.45) * exp(vY * 0.04);
          vec3 absorb = exp(-vDist * vec3(0.16, 0.04, 0.03));
          float fogF = 1.0 - exp(-vDist * 0.02);
          col = col * absorb + vec3(0.02, 0.17, 0.21) * fogF;
          col = pow(aces(col * 0.9), vec3(1.0 / 2.2));
          gl_FragColor = vec4(col, a);
        }`,
    }));
    this.cloud.frustumCulled = false;
    this.overlay.add(this.cloud);
  }

  readonly cloud: THREE.Points;
  readonly overlay = new THREE.Scene();
  private depthU = { value: null as THREE.Texture | null };
  private resU = { value: new THREE.Vector2(1, 1) };
  /** scene depth (resolved) + drawing-buffer size for the cloud's manual depth test */
  setDepth(tex: THREE.Texture, res: THREE.Vector2) { this.depthU.value = tex; this.resU.value.copy(res); }

  shift(dx: number, dz: number) {
    for (let j = 0; j < this.pos.length; j += 3) { this.pos[j] -= dx; this.pos[j + 2] -= dz; }
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, kind: number) {
    const i = this.head; this.head = (this.head + 1) % BUBBLE_N;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.life[i * 2] = 0; this.life[i * 2 + 1] = life;
    this.size[i] = size; this.kind[i] = kind;
    this.ph[i] = Math.random() * 6.28;
  }

  private puffAcc = 0;
  private bowAcc = 0;

  update(dt: number, t: number, boat: Vessel) {
    dt = Math.min(dt, 0.05);
    const sc = boat.spec.screws;
    const spin = boat.screwSpin, maxW = 30 / Math.sqrt(Math.max(sc.r, 0.1));
    const load = Math.min(Math.abs(spin) / maxW, 1);
    const waterY = boat.spec.submarine ? 0 : boat.group.position.y; // local water level near the hull
    // emission ∝ load² · blade area; capped so huge ships don't drain the pool
    const rate = Math.min(load * load * 260 * Math.sqrt(sc.r) * boat.screws.length, 900);
    this.acc += rate * dt;
    const q = boat.group.quaternion;
    this.ax.set(0, 0, 1).applyQuaternion(q); // aft
    this.up.set(0, 1, 0).applyQuaternion(q);
    this.side.crossVectors(this.ax, this.up);
    while (this.acc >= 1 && boat.screws.length) {
      this.acc -= 1;
      const m = boat.screws[(Math.random() * boat.screws.length) | 0];
      m.getWorldPosition(this.w);
      if (this.w.y > waterY - 0.1 && !boat.spec.submarine) continue; // screw out of the water
      // tip vortex: spawn on the blade circle
      const a = Math.random() * Math.PI * 2, rr = sc.r * (0.6 + Math.random() * 0.4);
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = this.w.x + (this.up.x * ca + this.side.x * sa) * rr;
      const py = this.w.y + (this.up.y * ca + this.side.y * sa) * rr;
      const pz = this.w.z + (this.up.z * ca + this.side.z * sa) * rr;
      // jet aft (sign of spin) + tangential swirl
      const jet = Math.sign(spin) * (1.5 + load * 4) * Math.sqrt(sc.r) * (0.6 + Math.random() * 0.6);
      const tan = spin * rr * 0.25 * m.userData.dir;
      const i = this.head; this.head = (this.head + 1) % BUBBLE_N;
      const j = i * 3;
      this.pos[j] = px; this.pos[j + 1] = py; this.pos[j + 2] = pz;
      this.vel[j] = this.ax.x * jet + (-this.up.x * sa + this.side.x * ca) * tan;
      this.vel[j + 1] = this.ax.y * jet + (-this.up.y * sa + this.side.y * ca) * tan;
      this.vel[j + 2] = this.ax.z * jet + (-this.up.z * sa + this.side.z * ca) * tan;
      this.life[i * 2] = 0; this.life[i * 2 + 1] = 1.5 + Math.random() * 2.5;
      this.size[i] = (0.012 + Math.random() * Math.random() * 0.045) * Math.min(Math.sqrt(sc.r * 3), 3);
      this.ph[i] = Math.random() * 6.28;
      this.kind[i] = 0;
    }
    // aerated wash cloud straight off the blades (the white turbulent plume)
    this.puffAcc += Math.min(load * load * 160 * boat.screws.length, 450) * dt;
    while (this.puffAcc >= 1 && boat.screws.length) {
      this.puffAcc -= 1;
      const m = boat.screws[(Math.random() * boat.screws.length) | 0];
      m.getWorldPosition(this.w);
      if (this.w.y > waterY - 0.1 && !boat.spec.submarine) continue;
      const a = Math.random() * 6.28, rr = sc.r * Math.sqrt(Math.random()) * 0.9;
      const ca = Math.cos(a), sa = Math.sin(a);
      const jet = Math.sign(spin) * (2 + load * 5) * Math.sqrt(sc.r) * (0.5 + Math.random() * 0.7);
      const tan = spin * rr * 0.2 * m.userData.dir;
      this.spawn(
        this.w.x + (this.up.x * ca + this.side.x * sa) * rr, this.w.y + (this.up.y * ca + this.side.y * sa) * rr, this.w.z + (this.up.z * ca + this.side.z * sa) * rr,
        this.ax.x * jet + (-this.up.x * sa + this.side.x * ca) * tan, this.ax.y * jet + (-this.up.y * sa + this.side.y * ca) * tan, this.ax.z * jet + (-this.up.z * sa + this.side.z * ca) * tan,
        0.6 + Math.random() * 0.8, Math.max(sc.r, 0.45) * (0.5 + Math.random() * 0.6), 1 + Math.random() * 0.9);
    }
    // bow: water slammed down along the forefoot drags air under the surface
    const v = Math.abs(boat.speed);
    if (!boat.spec.submarine || boat.surfaceContact > 0.5) {
      this.bowAcc += Math.min(Math.max(0, v - 2) * 25 * Math.sqrt(boat.spec.beam / 2.9), 400) * boat.surfaceContact * dt;
      const f = boat.forward;
      while (this.bowAcc >= 1) {
        this.bowAcc -= 1;
        const along = boat.spec.len * (0.42 - Math.random() * 0.3);
        const sd = (Math.random() < 0.5 ? -1 : 1) * boat.spec.beam * (0.25 + Math.random() * 0.25);
        const x = boat.pos.x + f.x * along - f.y * sd, z = boat.pos.y + f.y * along + f.x * sd;
        const big = Math.random() < 0.3;
        this.spawn(x, waterY - 0.3 - Math.random() * Math.min(boat.spec.beam * 0.1, 2), z,
          -f.y * Math.sign(sd) * 0.6, -0.3, f.x * Math.sign(sd) * 0.6,
          big ? 0.6 + Math.random() * 0.5 : 1 + Math.random() * 1.5,
          big ? Math.sqrt(boat.spec.beam) * (0.15 + Math.random() * 0.2) : 0.012 + Math.random() * 0.03, big ? 1 + Math.random() * 0.9 : 0);
      }
    }
    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < BUBBLE_N; i++) {
      const L = i * 2;
      if (this.life[L] >= this.life[L + 1]) continue;
      this.life[L] += dt;
      const j = i * 3;
      // buoyancy toward terminal rise speed (bigger bubbles rise faster) + zig-zag wobble
      const rise = this.kind[i] > 0.5 ? 0.4 : 0.25 + this.size[i] * 6;
      this.vel[j] = this.vel[j] * drag + Math.sin(t * 9 + this.ph[i]) * 0.3 * dt * 10;
      this.vel[j + 2] = this.vel[j + 2] * drag + Math.cos(t * 7 + this.ph[i]) * 0.3 * dt * 10;
      this.vel[j + 1] += (rise - this.vel[j + 1]) * (1 - Math.exp(-dt * 2));
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] > waterY - 0.15) this.life[L] = this.life[L + 1]; // popped at the surface
    }
    for (const a of this.attrs) a.needsUpdate = true;
  }
}
