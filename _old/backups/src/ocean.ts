import * as THREE from 'three';
import { WAVES_GLSL } from './waves';
import { NOISE_GLSL, SKY_GLSL } from './sky';
import { WAKE_GLSL } from './wake';

/** Polar grid centred on the camera: dense near, sparse to the horizon. */
function polarGrid(rings: number, segs: number, growth: number) {
  const pos: number[] = [0, 0, 0];
  const idx: number[] = [];
  for (let i = 1; i <= rings; i++) {
    const r = 0.35 * (Math.pow(growth, i) - 1) / (growth - 1);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segs, b0 = 1 + (i + 1) * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export const SHARED_GLSL = NOISE_GLSL + SKY_GLSL + WAVES_GLSL + WAKE_GLSL;

export function createOcean(uniforms: Record<string, THREE.IUniform>) {
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${SHARED_GLSL}
      varying vec3 vWorld;
      varying vec2 vBase;
      varying float vHeight;
      void main(){
        vec2 base = position.xz + uCamXZ;
        vec3 n;
        vec3 d = gerstner(base, n);
        vec4 wk = wakeSample(base);
        vec3 wp = vec3(base.x + d.x, d.y + wk.r, base.y + d.z);
        vWorld = wp; vBase = base; vHeight = d.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${SHARED_GLSL}
      varying vec3 vWorld;
      varying vec2 vBase;
      varying float vHeight;

      // small capillary waves: analytic normal perturbation
      vec2 detail(vec2 p, float dist){
        vec2 g = vec2(0.0);
        float fade = 1.0 - smoothstep(20.0, 260.0, dist);
        float amp = 0.11, freq = 1.6;
        vec2 dir = vec2(0.8, 0.6);
        mat2 rot = mat2(0.73, -0.68, 0.68, 0.73);
        for(int i=0;i<6;i++){
          float ph = dot(dir, p) * freq - uTime * sqrt(9.81 * freq) * 0.9;
          g += dir * cos(ph) * amp;
          dir = rot * dir; freq *= 1.55; amp *= 0.72;
        }
        float nz = fbm(p * 0.35 + uTime * 0.05) - 0.5;
        return g * fade * (0.8 + nz);
      }

      void main(){
        float dist = length(vWorld.xz - cameraPosition.xz);
        vec3 N;
        gerstner(vBase, N);
        // wake normal
        vec4 wk = wakeSample(vBase);
        float e = uWakeTexel;
        float hx = wakeSample(vBase + vec2(e, 0.0)).r - wakeSample(vBase - vec2(e, 0.0)).r;
        float hz = wakeSample(vBase + vec2(0.0, e)).r - wakeSample(vBase - vec2(0.0, e)).r;
        N = normalize(N + vec3(-hx, 0.0, -hz) / (2.0 * e) * 1.6);
        vec2 dg = detail(vBase, dist);
        N = normalize(N + vec3(-dg.x, 0.0, -dg.y) * 0.5);
        // far: flatten toward macro normal to avoid sparkle aliasing
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(300.0, 4000.0, dist) * 0.7));

        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = uSunDir;
        vec3 col;

        if (gl_FrontFacing) {
          float NdV = max(dot(N, V), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
          fres = mix(fres, 0.6, smoothstep(800.0, 6000.0, dist) * 0.5);
          vec3 R = reflect(-V, N);
          R.y = abs(R.y) + 0.01;
          vec3 refl = skyReflect(normalize(R));

          // water body + subsurface glow through wave crests
          vec3 deep = vec3(0.004, 0.035, 0.065);
          vec3 sssCol = vec3(0.02, 0.30, 0.28);
          float sunBack = pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 3.0);
          float crest = clamp(vHeight * 0.9 + 0.35, 0.0, 1.5);
          vec3 body = deep + sssCol * (0.25 + sunBack * 0.9) * crest * (0.4 + 0.6 * max(dot(N, L), 0.0));
          body += vec3(0.01, 0.05, 0.06) * max(L.y, 0.0);

          col = mix(body, refl, fres);

          // sun glitter
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 900.0) * 60.0 + pow(max(dot(N, H), 0.0), 120.0) * 1.2;
          col += SUN_COL * spec * fres * 4.0;

          // foam: wake + wave-crest whitecaps
          float crestFoam = smoothstep(0.75, 1.15, vHeight + (fbm(vBase * 0.6 + uTime * 0.1) - 0.5) * 0.8) * (1.0 - smoothstep(60.0, 400.0, dist));
          float foamTex = fbm(vBase * 0.55 / uWakeTexel + vec2(uTime * 0.2, 0.0));
          float foam = smoothstep(0.0, 0.7, wk.b) * smoothstep(0.62, 0.42, foamTex - wk.b * 0.5);
          foam = max(foam, crestFoam * smoothstep(0.5, 0.75, foamTex) * 0.6);
          vec3 foamCol = vec3(0.92, 0.95, 0.97) * (0.55 + 0.45 * max(dot(N, L), 0.0)) + vec3(0.05, 0.08, 0.1);
          col = mix(col, foamCol, foam * 0.92);

          // aerial perspective
          vec3 hz = skyBase(normalize(vec3(-V.x, 0.02, -V.z)));
          col = mix(col, hz, smoothstep(600.0, 9000.0, dist) * 0.85);
        } else {
          // seen from below: Snell's window + total internal reflection
          vec3 Nd = -N;
          vec3 T = refract(-V, Nd, 1.33);
          vec3 inner = vec3(0.02, 0.16, 0.22);
          vec3 Rr = reflect(-V, Nd);
          vec3 tir = mix(vec3(0.0, 0.025, 0.05), vec3(0.03, 0.22, 0.27), exp(Rr.y * 2.5));
          if (dot(T, T) < 0.01) {
            col = tir;
          } else {
            float cosT = clamp(dot(-V, -Nd), 0.0, 1.0);
            float trans = 1.0 - pow(1.0 - cosT, 5.0) * 0.9;
            col = skyColor(normalize(T)) * trans * vec3(0.75, 0.95, 1.0);
            // window rim glow
            float rim = smoothstep(0.35, 0.0, length(T.xz) - 0.75);
            col = mix(tir, col, smoothstep(0.0, 0.25, cosT));
          }
          float foam = clamp(wk.b * 1.4, 0.0, 1.0) * smoothstep(0.3, 0.7, fbm(vBase * 0.55 / uWakeTexel));
          col = mix(col, vec3(0.7, 0.85, 0.9), foam * 0.7);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(polarGrid(300, 400, 1.028), mat);
  mesh.frustumCulled = false;
  return mesh;
}
