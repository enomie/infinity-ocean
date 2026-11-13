import * as THREE from 'three';
import { SHARED_GLSL } from './ocean';

export function createPost(uniforms: Record<string, THREE.IUniform>) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      tColor: { value: null },
      tDepth: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uRes: { value: new THREE.Vector2() },
      uLensMode: { value: 1 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${SHARED_GLSL}
      uniform sampler2D tColor, tDepth;
      uniform mat4 uInvProj, uCamWorld;
      uniform vec3 uCamPos;
      uniform vec2 uRes;
      uniform int uLensMode; // 0 clearly above, 1 near surface, 2 clearly below
      varying vec2 vUv;

      vec3 worldAt(vec2 uv, float depth){
        vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        v /= v.w;
        return (uCamWorld * v).xyz;
      }
      float surfaceAt(vec2 xz){ return gerstnerHeight(xz) + wakeSample(xz).r; }

      vec3 aces(vec3 x){
        const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
      }
      float caustic(vec2 p){
        float t = uTime * 0.6;
        float c = 0.0;
        vec2 q = p;
        for(int i=0;i<3;i++){
          q = q * 1.7 + vec2(sin(q.y * 1.3 + t), cos(q.x * 1.1 - t));
          c += abs(sin(q.x) * sin(q.y));
        }
        return pow(1.0 - c / 3.0, 6.0);
      }

      void main(){
        // which side of the surface is the lens (near plane) on?
        float lens = uLensMode == 0 ? 1.0 : -1.0;
        if (uLensMode == 1) {
          vec3 nearP = worldAt(vUv, 0.0);
          lens = nearP.y - surfaceAt(nearP.xz);    // <0: underwater
        }
        float under = 1.0 - smoothstep(-0.015, 0.015, lens);

        vec2 uv = vUv;
        if (under > 0.0) uv += vec2(sin(vUv.y * 40.0 + uTime * 2.0), cos(vUv.x * 35.0 + uTime * 1.7)) * 0.0015 * under;
        vec3 col = texture2D(tColor, uv).rgb;
        float depth = texture2D(tDepth, uv).r;

        if (under > 0.0) {
          vec3 wp = worldAt(uv, depth);
          vec3 rd = normalize(wp - uCamPos);
          float dist = depth >= 1.0 ? 1e4 : length(wp - uCamPos);
          float camDepth = max(-uCamPos.y, 0.0);
          // water colour depends on how much we look up toward the light
          float up = rd.y * 0.5 + 0.5;
          vec3 fogCol = mix(vec3(0.0, 0.03, 0.06), vec3(0.03, 0.26, 0.32), pow(up, 2.0));
          fogCol *= exp(-camDepth * 0.04);
          vec3 sunW = normalize(refract(-uSunDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.33));
          fogCol += vec3(0.05, 0.28, 0.25) * pow(max(dot(rd, -sunW), 0.0), 5.0) * 0.7;
          vec3 absorb = exp(-min(dist, 400.0) * vec3(0.16, 0.04, 0.03));
          float fogF = 1.0 - exp(-dist * 0.02);
          // caustics dancing on submerged surfaces
          if (depth < 1.0 && wp.y < 0.0) {
            vec2 cp = wp.xz - sunW.xz / sunW.y * wp.y;
            col *= 1.0 + caustic(cp * 0.8) * 2.5 * exp(wp.y * 0.25);
          }
          vec3 uw = col * absorb + fogCol * fogF;

          // god rays: march view ray, light shafts projected from surface along sun
          float rays = 0.0;
          float mx = min(dist, 40.0);
          float jitter = fract(sin(dot(vUv * uRes, vec2(12.9898, 78.233))) * 43758.5453);
          for (int i = 0; i < 8; i++) {
            float s = (float(i) + jitter) / 8.0 * mx;
            vec3 p = uCamPos + rd * s;
            if (p.y > 0.0) continue;
            vec2 sp = p.xz - sunW.xz / sunW.y * p.y;
            rays += caustic(sp * 0.35) * exp(p.y * 0.12) * exp(-s * 0.06);
          }
          uw += vec3(0.35, 0.75, 0.7) * rays / 8.0 * 0.8 * smoothstep(-0.3, 0.6, rd.y);
          col = mix(col, uw, under);
        }

        // meniscus: thin dark/bright line where the surface crosses the lens
        float line = exp(-pow(lens / 0.012, 2.0));
        float lineHi = exp(-pow((lens - 0.02) / 0.01, 2.0));
        col = col * (1.0 - line * 0.75) + vec3(0.6, 0.85, 0.9) * lineHi * 0.25;
        // droplets/blur band just above the line
        if (lens > 0.0 && lens < 0.08) {
          float b = 1.0 - lens / 0.08;
          vec3 bl = vec3(0.0);
          for (int i = -2; i <= 2; i++) bl += texture2D(tColor, uv + vec2(0.0, float(i) * 0.004 * b)).rgb;
          col = mix(col, bl / 5.0 * vec3(0.85, 0.95, 1.0), b * 0.7);
        }

        // vignette + tone map
        vec2 q = vUv - 0.5;
        col *= 1.0 - dot(q, q) * 0.45;
        col = aces(col * 0.9);
        col = pow(col, vec3(1.0 / 2.2));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  return { scene, mat, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
}
