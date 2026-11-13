import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.22, -0.8).normalize();

/** value noise from a 256² random texture (bilinear + smoothstep remap) */
export const NOISE_GLSL = /* glsl */ `
uniform sampler2D tNoise;
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(tNoise, (i + f + 0.5) / 256.0, 0.0).r;
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for(int i=0;i<5;i++){ s += a * vnoise(p); p = m * p; a *= 0.5; }
  return s;
}
float fbm3(vec2 p){
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  float s = 0.5 * vnoise(p); p = m * p;
  s += 0.25 * vnoise(p); p = m * p;
  return s + 0.125 * vnoise(p) + 0.0625;
}
`;

/** shared random bytes: GPU noise texture and the CPU mirror (terrain) read the same data */
export const NOISE_DATA = (() => {
  const data = new Uint8Array(256 * 256 * 4);
  let seed = 1337;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = seed >>> 24;
  }
  return data;
})();

function noiseTexture() {
  const tex = new THREE.DataTexture(NOISE_DATA, 256, 256);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Analytic sky: rayleigh-ish gradient, mie sun glow, sun disk, layered clouds. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSkyTime;
const vec3 SUN_COL = vec3(1.0, 0.86, 0.68);

vec3 skyBase(vec3 rd){
  float y = rd.y;
  float sd = max(dot(rd, uSunDir), 0.0);
  vec3 zenith  = vec3(0.10, 0.26, 0.62);
  vec3 horizon = vec3(0.70, 0.80, 0.90);
  float h = pow(max(y, 0.0), 0.45);
  vec3 col = mix(horizon, zenith, h);
  // warm haze toward sun at horizon
  col = mix(col, vec3(1.0, 0.78, 0.55), pow(sd, 6.0) * (1.0 - h) * 0.55);
  col += SUN_COL * pow(sd, 18.0) * 0.45;
  col += SUN_COL * pow(sd, 400.0) * 3.0;
  // below horizon: hazy sea-air
  if (y < 0.0) col = mix(horizon * 0.9, vec3(0.30, 0.42, 0.50), clamp(-y * 3.0, 0.0, 1.0));
  return col;
}

vec4 clouds(vec3 rd){
  if (rd.y <= 0.0) return vec4(0.0);
  vec2 p = rd.xz / (rd.y + 0.06) * 1.3 + vec2(uSkyTime * 0.012, uSkyTime * 0.004);
  float n = fbm(p * 1.1);
  float n2 = fbm(p * 3.2 + n * 1.5);
  float d = smoothstep(0.48, 0.82, n * 0.75 + n2 * 0.35);
  // thickness probe toward the sun for self-shadowing
  vec2 ps = p + uSunDir.xz * 0.12;
  float ns = fbm(ps * 1.1) * 0.75 + fbm(ps * 3.2 + n * 1.5) * 0.35;
  float shade = clamp(1.0 - (ns - 0.5) * 2.2, 0.25, 1.0);
  float sd = max(dot(rd, uSunDir), 0.0);
  vec3 lit = mix(vec3(0.55, 0.60, 0.70), vec3(1.05, 1.0, 0.95), shade);
  lit += SUN_COL * pow(sd, 10.0) * (1.0 - d) * 1.8; // silver lining
  float fade = smoothstep(0.0, 0.18, rd.y);
  return vec4(lit, d * fade * 0.92);
}

vec3 skyColor(vec3 rd){
  vec3 col = skyBase(rd);
  float sd = max(dot(rd, uSunDir), 0.0);
  col += vec3(40.0, 34.0, 26.0) * smoothstep(0.99975, 0.99990, sd);
  vec4 c = clouds(rd);
  col = mix(col, c.rgb, c.a);
  return col;
}

// cheaper version for reflections (no disk – specular handles it)
vec3 skyReflect(vec3 rd){
  vec3 col = skyBase(rd);
  vec4 c = clouds(rd);
  return mix(col, c.rgb, c.a);
}
`;

export function skyUniforms() {
  return {
    uSunDir: { value: SUN_DIR },
    uSkyTime: { value: 0 },
    tNoise: { value: noiseTexture() },
    tSkyCube: { value: null as THREE.Texture | null },
  };
}

/**
 * Sky rendered into a cubemap, one face per frame (clouds drift slowly).
 * Dome and water reflections then only need a texture lookup.
 */
export class SkyCube {
  readonly rt = new THREE.WebGLCubeRenderTarget(384, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  private cam = new THREE.CubeCamera(1, 2000, this.rt);
  private scene = new THREE.Scene();
  private face = 0;
  constructor(private renderer: THREE.WebGLRenderer, uniforms: ReturnType<typeof skyUniforms>) {
    this.scene.add(createSky(uniforms, true));
    this.cam.update(renderer, this.scene); // full init
  }
  update() {
    const cams = this.cam.children as THREE.PerspectiveCamera[];
    const prevMip = this.rt.texture.generateMipmaps;
    this.rt.texture.generateMipmaps = this.face === 5 && prevMip;
    this.renderer.setRenderTarget(this.rt, this.face);
    this.renderer.render(this.scene, cams[this.face]);
    this.rt.texture.generateMipmaps = prevMip;
    this.renderer.setRenderTarget(null);
    this.face = (this.face + 1) % 6;
  }
}

export function createSky(uniforms: ReturnType<typeof skyUniforms>, analytic = false) {
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${SKY_GLSL}
      varying vec3 vDir;
      uniform samplerCube tSkyCube;
      void main(){
        vec3 rd = normalize(vDir);
        ${analytic ? 'vec3 col = skyReflect(rd);' : `vec3 col = textureLod(tSkyCube, rd, 0.0).rgb;
        float sd = max(dot(rd, uSunDir), 0.0);
        col += vec3(40.0, 34.0, 26.0) * smoothstep(0.99975, 0.99990, sd);`}
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
