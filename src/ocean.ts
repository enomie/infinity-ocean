import * as THREE from 'three';
import { WAVES_GLSL } from './waves';
import { NOISE_GLSL, SKY_GLSL } from './sky';
import { WAKE_GLSL } from './wake';
import { TERRAIN_GLSL } from './world/terrain';

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

export const SHARED_GLSL = NOISE_GLSL + SKY_GLSL + TERRAIN_GLSL + WAVES_GLSL + WAKE_GLSL;

export function createOcean(uniforms: Record<string, THREE.IUniform>) {
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${SHARED_GLSL}
      varying vec3 vWorld;
      varying vec2 vBase;
      varying vec3 vNormal;
      varying vec2 vHJ; // height, jacobian
      varying float vDepth; // water depth to terrain (m)
      void main(){
        vec2 base = position.xz + uCamXZ;
        float J;
        vec3 n;
        float th = terrainHeight(base);
        vec3 d = gerstnerJs(base, shoreFade(-th), J, n);
        vec4 wk = wakeSample(base);
        vec3 wp = vec3(base.x + d.x, d.y + wk.r, base.y + d.z);
        vWorld = wp; vBase = base; vNormal = n; vHJ = vec2(d.y, J);
        vDepth = -th;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${SHARED_GLSL}
      uniform samplerCube tSkyCube;
      varying vec3 vWorld;
      varying vec2 vBase;
      varying vec3 vNormal;
      varying vec2 vHJ;
      varying float vDepth;

      vec3 sky(vec3 d){ return textureLod(tSkyCube, d, 0.0).rgb; }
      float rip(vec2 p){
        return vnoise(p * 0.55 + uTime * vec2(0.35, 0.12)) * 0.11
             + vnoise(mat2(0.8, -0.6, 0.6, 0.8) * p * 1.3 - uTime * vec2(0.1, 0.5)) * 0.05
             + vnoise(mat2(0.3, 0.95, -0.95, 0.3) * p * 3.1 + uTime * vec2(0.6, -0.3)) * 0.02;
      }

      // cellular noise → (F1, F2): foam gathers on the cell borders like real sea foam lace
      vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
      vec2 worley(vec2 p){
        vec2 i = floor(p), f = fract(p);
        float f1 = 8.0, f2 = 8.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(x, y);
          vec2 o = hash2(i + g);
          o = 0.5 + 0.45 * sin(uTime * 0.35 + 6.2831 * o);
          float d = dot(g + o - f, g + o - f);
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
        return sqrt(vec2(f1, f2));
      }
      /** wake foam: dense white core, lacy cell borders at the fading edge, bubbles below */
      float wakeFoamAt(vec2 p, float b, out float aer){
        aer = smoothstep(0.0, 0.35, b);
        if (b < 0.004) return 0.0;
        float n = fbm3(p * 0.35 + vec2(uTime * 0.1, 0.0));
        // strong domain warp → torn, organic cells instead of tiles
        vec2 warp = vec2(fbm3(p * 0.5 + 3.1), fbm3(p * 0.5 - 7.3)) - 0.5;
        vec2 w1 = worley(p * 0.7 + warp * 2.2);
        vec2 w2 = worley(p * 1.9 + warp * 3.5 + 11.0);
        float brk = fbm3(p * 1.4 - uTime * 0.07); // breaks the lace strands
        float lace = (1.0 - smoothstep(0.0, 0.1 + n * 0.12, w1.y - w1.x)) * smoothstep(0.3, 0.5, brk);
        float fine = (1.0 - smoothstep(0.0, 0.07, w2.y - w2.x)) * smoothstep(0.45, 0.65, brk + n * 0.3);
        float core = smoothstep(0.55, 1.0, b + (n - 0.5) * 0.6);
        // patches: foam clumps where cells are small, so the fading edge reads as streaks + islands
        float clump = smoothstep(0.62, 0.78, n + b * 0.35) * smoothstep(0.05, 0.4, b) * smoothstep(0.35, 0.55, brk);
        float edge = smoothstep(0.02, 0.3, b) * max(lace, fine * 0.6);
        return clamp(max(max(core, clump), edge), 0.0, 1.0);
      }

      void main(){
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec3 N = normalize(vNormal);

        // wake: height + foam, slope by central differences (only inside window)
        vec2 wuv = wakeUV(vBase);
        vec4 wk = vec4(0.0);
        if (all(greaterThan(wuv, vec2(0.0))) && all(lessThan(wuv, vec2(1.0)))) {
          wk = texture2D(tWake, wuv);
          float e = 1.0 / 1024.0;
          float hx = texture2D(tWake, wuv + vec2(e, 0.0)).r - texture2D(tWake, wuv - vec2(e, 0.0)).r;
          float hz = texture2D(tWake, wuv + vec2(0.0, e)).r - texture2D(tWake, wuv - vec2(0.0, e)).r;
          N = normalize(N + vec3(-hx, 0.0, -hz) / (2.0 * uWakeTexel) * 1.6);
        }

        // detail waves: two octaves of the animated slope map
        float dfade = 1.0 - smoothstep(15.0, 250.0, dist);
        // isotropic, non-repeating ripples: gradient of drifting value noise (3 octaves)
        vec2 sl = vec2(0.0);
        if (dfade > 0.0) {
          vec2 q = vBase;
          const float E = 0.06;
          float hc = rip(q);
          sl = vec2(rip(q + vec2(E, 0.0)) - hc, rip(q + vec2(0.0, E)) - hc) / E;
        }
        sl *= (0.1 + 0.9 * dfade) * mix(0.3, 1.0, sqrt(max(V.y, 0.0)));
        N = normalize(N + vec3(-sl.x, 0.0, -sl.y));
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(400.0, 5000.0, dist) * 0.6));

        vec3 L = uSunDir;
        vec3 col;
        float h = vHJ.x;

        if (gl_FrontFacing) {
          float NdV = max(dot(N, V), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
          vec3 R = reflect(-V, N);
          R.y = abs(R.y) + 0.01;
          vec3 refl = sky(normalize(R));

          // body colour + subsurface glow in thin, sunlit crests
          vec3 deep = vec3(0.004, 0.032, 0.062);
          vec3 sssCol = vec3(0.02, 0.32, 0.29);
          float sunBack = pow(clamp(dot(-V, L) * 0.5 + 0.5, 0.0, 1.0), 3.0);
          float crest = clamp(h * 0.8 + 0.35 + (1.0 - vHJ.y) * 0.6, 0.0, 1.6);
          vec3 body = deep + sssCol * (0.2 + sunBack * 1.0) * crest * (0.4 + 0.6 * max(dot(N, L), 0.0));
          body += vec3(0.01, 0.045, 0.055) * max(L.y, 0.0);
          // shallows: sand shows through as turquoise
          float shallow = 1.0 - smoothstep(0.0, 9.0, vDepth);
          vec3 sandSeen = mix(vec3(0.05, 0.42, 0.40), vec3(0.45, 0.62, 0.52), 1.0 - smoothstep(0.0, 2.5, vDepth));
          body = mix(body, sandSeen * (0.5 + 0.5 * max(L.y, 0.0)), shallow * 0.85);
          col = mix(body, refl, fres);

          vec3 H = normalize(L + V);
          float nh = max(dot(N, H), 0.0);
          col += SUN_COL * (pow(nh, 1200.0) * 70.0 + pow(nh, 140.0) * 1.0) * fres * 4.0;

          // foam: wake + Jacobian whitecaps, broken up by noise
          float n1 = fbm3(vBase * 0.55 / uWakeTexel + vec2(uTime * 0.2, 0.0));
          float aer;
          float wakeFoam = dist < 400.0 ? wakeFoamAt(vBase, wk.b * 1.4, aer) : 0.0;
          // aerated water under/around foam glows turquoise (bubbles scatter light)
          col = mix(col, vec3(0.06, 0.32, 0.33) * (0.4 + 0.6 * max(L.y, 0.0)) + refl * fres * 0.5, aer * 0.55);
          float n2 = fbm3(vBase * 0.45 + uTime * 0.08);
          float capFoam = smoothstep(0.5, 0.3, vHJ.y + (n2 - 0.5) * 0.3) * (1.0 - smoothstep(80.0, 600.0, dist));
          // surf: bands of foam rolling onto the beach
          float surfN = fbm3(vBase * 0.25 + uTime * 0.05);
          float surf = (1.0 - smoothstep(0.0, 1.6, vDepth)) * smoothstep(0.35, 0.75, 0.5 + 0.5 * sin(uTime * 1.3 - vDepth * 4.0 + surfN * 6.0));
          surf = max(surf, 1.0 - smoothstep(0.05, 0.35, vDepth));
          float foam = max(max(wakeFoam, capFoam * 0.85), surf * smoothstep(0.3, 0.6, n1 + 0.15) * step(-0.2, vDepth));
          vec3 foamCol = vec3(0.9, 0.94, 0.96) * (0.55 + 0.45 * max(dot(N, L), 0.0)) + vec3(0.05, 0.08, 0.1);
          col = mix(col, foamCol, foam * 0.92);

          vec3 hz = skyBase(normalize(vec3(-V.x, 0.02, -V.z)));
          col = mix(col, hz, smoothstep(600.0, 9000.0, dist) * 0.85);
        } else {
          // seen from below: Snell's window + total internal reflection
          vec3 Nd = -N;
          vec3 T = refract(-V, Nd, 1.33);
          vec3 Rr = reflect(-V, Nd);
          vec3 tir = mix(vec3(0.0, 0.025, 0.05), vec3(0.03, 0.22, 0.27), exp(Rr.y * 2.5));
          if (dot(T, T) < 0.01) {
            col = tir;
          } else {
            float cosT = clamp(dot(-V, -Nd), 0.0, 1.0);
            float trans = 1.0 - pow(1.0 - cosT, 5.0) * 0.9;
            col = mix(tir, sky(normalize(T)) * trans * vec3(0.75, 0.95, 1.0), smoothstep(0.0, 0.25, cosT));
          }
          float aer;
          float foam = wakeFoamAt(vBase, wk.b * 1.4, aer);
          col = mix(col, vec3(0.05, 0.3, 0.34), aer * 0.4);
          col = mix(col, vec3(0.7, 0.85, 0.9), foam * 0.75);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(polarGrid(260, 360, 1.032), mat);
  mesh.frustumCulled = false;
  return mesh;
}
