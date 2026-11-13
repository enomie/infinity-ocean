import * as THREE from 'three';

/** Gerstner wave set: [direction angle (rad), amplitude (m), wavelength (m), phase] */
const SPEC: [number, number, number, number][] = [
  [0.25, 0.55, 64, 0.0],
  [0.85, 0.3, 37, 1.3],
  [-0.45, 0.22, 23, 2.1],
  [1.55, 0.13, 14.5, 4.0],
  [0.05, 0.085, 9.2, 0.7],
  [-1.15, 0.06, 6.1, 5.2],
  [2.3, 0.038, 4.1, 3.3],
  [0.7, 0.024, 2.7, 1.9],
];
export const WAVE_COUNT = SPEC.length;
export const STEEPNESS = 0.62;

export const waveUniform = SPEC.map(
  ([a, amp, len]) => new THREE.Vector4(Math.cos(a), Math.sin(a), amp, len),
);
export const phaseUniform = SPEC.map((s) => s[3]);

/** GLSL shared by ocean, post and anything that needs the surface. */
export const WAVES_GLSL = /* glsl */ `
#define WAVE_COUNT ${WAVE_COUNT}
uniform vec4 uWaves[WAVE_COUNT];
uniform float uPhase[WAVE_COUNT];
uniform float uTime;
uniform vec2 uCamXZ;

float waveFade(float L, float dist){ return 1.0 - smoothstep(L*18.0, L*70.0, dist); }

// displacement + analytic normal at undisplaced point p
vec3 gerstner(vec2 p, out vec3 nrm){
  vec3 d = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float dist = length(p - uCamXZ);
  for(int i=0;i<WAVE_COUNT;i++){
    vec4 w = uWaves[i];
    float k = 6.2831853 / w.w;
    float c = sqrt(9.81 / k);
    float A = w.z * waveFade(w.w, dist);
    float f = k * (dot(w.xy, p) - c * uTime) + uPhase[i];
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
  for (let i = 0; i < WAVE_COUNT; i++) {
    const w = waveUniform[i];
    const k = (Math.PI * 2) / w.w;
    const c = Math.sqrt(9.81 / k);
    const fade = 1 - smooth(w.w * 18, w.w * 70, dist);
    const A = w.z * fade;
    const f = k * (w.x * px + w.y * pz - c * t) + phaseUniform[i];
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
