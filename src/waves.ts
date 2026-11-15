import * as THREE from 'three';
import { shoreFade, terrainHeight } from './world/terrain';
import { ORIGIN } from './world/origin';

/**
 * Wind-sea spectrum sampled into Gerstner waves: wavelengths log-spaced
 * 140 m → 2.4 m, directions spread around the wind (wider for short waves),
 * irrational-ish lengths/phases so the pattern never visibly repeats.
 */
const WIND = 0.25;
const SPEC: [number, number, number, number][] = (() => {
  const out: [number, number, number, number][] = [];
  let seed = 9001;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const N = 20;
  for (let i = 0; i < N; i++) {
    const L = 140 * Math.pow(2.4 / 140, i / (N - 1)) * (0.93 + rnd() * 0.14);
    const spread = 0.6 + 0.9 * (i / (N - 1));
    // every 5th wave belongs to a crossing swell system → no single dominant stripe direction
    const dir = WIND + (i % 5 === 2 ? 1.1 : 0) + (rnd() * 2 - 1) * spread;
    // steepness peaks in the mid band (wind sea), long swell is gentle
    const steep = 0.028 + 0.02 * Math.sin(Math.PI * Math.min(i / (N * 0.7), 1));
    out.push([dir, (steep * L) / (2 * Math.PI) * 1.1 * (0.8 + rnd() * 0.4), L, rnd() * 6.283]);
  }
  return out;
})();
export const WAVE_COUNT = SPEC.length;
export const STEEPNESS = 0.58;

export const waveUniform = SPEC.map(
  ([a, amp, len]) => new THREE.Vector4(Math.cos(a), Math.sin(a), amp, len),
);
const PHASE0 = SPEC.map((s) => s[3]);
/** live phases for the GPU: k·D·origin − ω·t + φ0, wrapped in double precision */
export const phaseUniform = PHASE0.slice();
export function updateWavePhases(t: number) {
  for (let i = 0; i < WAVE_COUNT; i++) {
    const w = waveUniform[i];
    const k = (Math.PI * 2) / w.w, c = Math.sqrt(9.81 / k);
    const f = k * (w.x * ORIGIN.x + w.y * ORIGIN.z - c * t) + PHASE0[i];
    phaseUniform[i] = f - Math.floor(f / (Math.PI * 2)) * Math.PI * 2;
  }
}

/** GLSL shared by ocean, post and anything that needs the surface. */
export const WAVES_GLSL = /* glsl */ `
#define WAVE_COUNT ${WAVE_COUNT}
uniform vec4 uWaves[WAVE_COUNT];
uniform float uPhase[WAVE_COUNT];
uniform float uTime;
uniform vec2 uCamXZ;

float waveFade(float L, float dist){ return 1.0 - smoothstep(L*5.0, L*13.0, dist); }

// displacement + analytic normal at undisplaced point p
vec3 gerstner(vec2 p, out vec3 nrm){
  vec3 d = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float dist = length(p - uCamXZ);
  float sf = shoreFade(-terrainHeight(p)); // swell dies in the shallows
  for(int i=0;i<WAVE_COUNT;i++){
    vec4 w = uWaves[i];
    float k = 6.2831853 / w.w;
    float A = w.z * waveFade(w.w, dist) * sf;
    float f = k * dot(w.xy, p) + uPhase[i];
    float Q = ${STEEPNESS.toFixed(3)} / (k * w.z * float(WAVE_COUNT));
    float S = sin(f), C = cos(f);
    d.xz += Q * A * w.xy * C;
    d.y  += A * S;
    n.xz -= w.xy * k * A * C;
    n.y  -= Q * k * A * S;
  }
  nrm = normalize(n);
  return d;
}
// displacement + Jacobian determinant of the horizontal map (J<1 → crests compress → foam)
vec3 gerstnerJs(vec2 p, float sf, out float J, out vec3 nrm){
  vec3 d = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float jxx = 1.0, jzz = 1.0, jxz = 0.0;
  float dist = length(p - uCamXZ);
  for(int i=0;i<WAVE_COUNT;i++){
    vec4 w = uWaves[i];
    float k = 6.2831853 / w.w;
    float A = w.z * waveFade(w.w, dist) * sf;
    float f = k * dot(w.xy, p) + uPhase[i];
    float Q = ${STEEPNESS.toFixed(3)} / (k * w.z * float(WAVE_COUNT));
    float S = sin(f), C = cos(f);
    d.xz += Q * A * w.xy * C;
    d.y  += A * S;
    n.xz -= w.xy * k * A * C;
    n.y  -= Q * k * A * S;
    float qs = Q * A * k * S;
    jxx -= qs * w.x * w.x;
    jzz -= qs * w.y * w.y;
    jxz -= qs * w.x * w.y;
  }
  J = jxx * jzz - jxz * jxz;
  nrm = normalize(n);
  return d;
}
vec3 gerstnerJ(vec2 p, out float J, out vec3 nrm){ return gerstnerJs(p, shoreFade(-terrainHeight(p)), J, nrm); }
vec3 gerstnerD(vec2 p){ vec3 n; return gerstner(p, n); }

// height of the displaced surface above world xz (fixed point iteration)
float gerstnerHeight(vec2 xz){
  vec2 p = xz;
  for(int i=0;i<3;i++){ vec3 d = gerstnerD(p); p = xz - d.xz; }
  return gerstnerD(p).y;
}
`;

const _p = new THREE.Vector2();
function disp(px: number, pz: number, t: number, cam: THREE.Vector2, out: THREE.Vector3) {
  out.set(0, 0, 0);
  const dist = Math.hypot(px - cam.x, pz - cam.y);
  const sf = shoreFade(-terrainHeight(px, pz));
  for (let i = 0; i < WAVE_COUNT; i++) {
    const w = waveUniform[i];
    const k = (Math.PI * 2) / w.w;
    const c = Math.sqrt(9.81 / k);
    const fade = 1 - smooth(w.w * 5, w.w * 13, dist);
    const A = w.z * fade * sf;
    const f = k * (w.x * (px + ORIGIN.x) + w.y * (pz + ORIGIN.z) - c * t) + PHASE0[i]; // doubles: exact at any distance
    const Q = STEEPNESS / (k * w.z * WAVE_COUNT);
    const C = Math.cos(f);
    out.x += Q * A * w.x * C;
    out.z += Q * A * w.y * C;
    out.y += A * Math.sin(f);
  }
  return out;
}
function smooth(a: number, b: number, x: number) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

const _d = new THREE.Vector3();
/** CPU mirror of gerstnerHeight */
export function waveHeight(x: number, z: number, t: number, cam: THREE.Vector2): number {
  _p.set(x, z);
  for (let i = 0; i < 4; i++) {
    disp(_p.x, _p.y, t, cam, _d);
    _p.set(x - _d.x, z - _d.z);
  }
  return disp(_p.x, _p.y, t, cam, _d).y;
}
