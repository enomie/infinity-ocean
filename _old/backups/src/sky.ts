import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.22, -0.8).normalize();

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for(int i=0;i<5;i++){ s += a * vnoise(p); p = m * p; a *= 0.5; }
  return s;
}
`;

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
  };
}

export function createSky(uniforms: ReturnType<typeof skyUniforms>) {
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
      void main(){ gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0); }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
