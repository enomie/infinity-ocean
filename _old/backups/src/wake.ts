import * as THREE from 'three';

export const WAKE_RES = 512;
const BASE_TEXEL = 0.25; // meters for the 9 m reference boat

/**
 * Local ripple simulation (linear wave equation + foam) in a window that
 * scrolls with the boat. R = height, G = previous height, B = foam.
 */
export class Wake {
  private rt: THREE.WebGLRenderTarget[];
  private idx = 0;
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly center = new THREE.Vector2();
  private acc = 0;
  texel = BASE_TEXEL;

  constructor(private renderer: THREE.WebGLRenderer) {
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    this.rt = [new THREE.WebGLRenderTarget(WAKE_RES, WAKE_RES, opts), new THREE.WebGLRenderTarget(WAKE_RES, WAKE_RES, opts)];
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tPrev: { value: null },
        uShift: { value: new THREE.Vector2() },
        uCenter: { value: this.center },
        uBoatPos: { value: new THREE.Vector2() },
        uBoatFwd: { value: new THREE.Vector2(0, -1) },
        uSpeed: { value: 0 },
        uThrottle: { value: 0 },
        uTime: { value: 0 },
        uHeave: { value: 0 },
        uTex: { value: BASE_TEXEL },
        uScale: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tPrev;
        uniform vec2 uShift, uCenter, uBoatPos, uBoatFwd;
        uniform float uSpeed, uThrottle, uTime, uHeave, uTex;
        uniform vec2 uScale;
        varying vec2 vUv;
        const float RES = ${WAKE_RES.toFixed(1)};
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        vec4 S(vec2 uv){
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
          return texture2D(tPrev, uv);
        }
        void main(){
          vec2 uv = vUv + uShift / RES;
          vec2 e = vec2(1.0 / RES, 0.0);
          vec4 c = S(uv);
          vec4 l = S(uv - e.xy), r = S(uv + e.xy), d = S(uv - e.yx), u = S(uv + e.yx);
          float lap = l.r + r.r + d.r + u.r - 4.0 * c.r;
          // wave speed ~4.5 m/s, dt = 1/60
          float sc = uScale.x;
          float k = pow(4.5 * sqrt(sc) * (1.0/60.0) / uTex, 2.0);
          float h = c.r + (c.r - c.g) * 0.992 + k * lap;
          h *= 0.9993;

          // world position of this texel
          vec2 wp = uCenter + (vUv - 0.5) * RES * uTex;
          vec2 rel = wp - uBoatPos;
          vec2 right = vec2(-uBoatFwd.y, uBoatFwd.x);
          // hull-normalised coords: all constants below are for a 9 m x 2.9 m boat
          float lz = dot(rel, uBoatFwd) / uScale.x;
          float lx = dot(rel, right) / uScale.y;
          // hull footprint (pointy bow, wide stern)
          float s = clamp((lz + 4.5) / 9.0, 0.0, 1.0); // 0 stern .. 1 bow
          float halfW = 1.45 * (s > 0.55 ? 1.0 - pow((s - 0.55) / 0.45, 1.6) : 1.0 - 0.12 * pow((0.55 - s) / 0.55, 2.0));
          float inside = step(abs(lz), 4.5) * smoothstep(halfW + 0.15, halfW - 0.25, abs(lx));
          // moving pressure source → Kelvin-like wake
          float press = -(0.08 + 0.05 * uSpeed / sqrt(sc)) * sqrt(sc) * inside + uHeave * inside * 0.6;
          h = mix(h, press, inside * 0.22);

          // foam
          float foam = (c.b * 4.0 + l.b + r.b + d.b + u.b) / 8.0 * 0.968;
          float edge = step(abs(lz), 4.6) * smoothstep(0.5, 0.0, abs(abs(lx) - halfW)) * smoothstep(-4.5, 4.0, lz);
          float bow = smoothstep(1.2, 0.0, length(vec2(lx * 0.8, lz - 4.0)));
          float jitter = hash(wp * 3.1 + uTime);
          foam += (edge * 0.007 + bow * 0.012) * uSpeed * jitter;
          // propeller wash behind the transom
          float wash = smoothstep(1.4, 0.0, abs(lx)) * smoothstep(-9.0, -4.6, lz) * step(lz, -4.4);
          foam += wash * abs(uThrottle) * 0.03 * jitter;
          h += wash * abs(uThrottle) * (jitter - 0.5) * 0.02 / (sc * sc);
          // steep ripples break into foam
          foam += smoothstep(0.03, 0.1, abs(lap)) * 0.01;
          foam = clamp(foam, 0.0, 1.0);

          // fade at window edge
          vec2 ed = smoothstep(0.0, 0.06, vUv) * smoothstep(1.0, 0.94, vUv);
          float ef = ed.x * ed.y;
          gl_FragColor = vec4(h * ef, c.r * ef, foam * ef, 1.0);
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.scene.add(quad);
  }

  /** resize the simulated window for a vessel (len, beam in m); clears the sim */
  setVessel(len: number, beam: number) {
    const sx = Math.max(len / 9, 0.7), sy = Math.max(beam / 2.9, 0.7);
    this.texel = BASE_TEXEL * Math.max(sx, 1);
    const u = this.mat.uniforms;
    u.uTex.value = this.texel;
    u.uScale.value.set(sx, sy);
    for (const r of this.rt) {
      this.renderer.setRenderTarget(r);
      this.renderer.clear();
    }
    this.renderer.setRenderTarget(null);
  }

  get size() {
    return WAKE_RES * this.texel;
  }

  get texture() {
    return this.rt[this.idx].texture;
  }

  update(dt: number, boatPos: THREE.Vector2, fwd: THREE.Vector2, speed: number, throttle: number, heave: number, time: number) {
    this.acc += Math.min(dt, 0.1);
    const u = this.mat.uniforms;
    while (this.acc >= 1 / 60) {
      this.acc -= 1 / 60;
      const nx = Math.round(boatPos.x / this.texel) * this.texel;
      const nz = Math.round(boatPos.y / this.texel) * this.texel;
      u.uShift.value.set((nx - this.center.x) / this.texel, (nz - this.center.y) / this.texel);
      this.center.set(nx, nz);
      u.tPrev.value = this.rt[this.idx].texture;
      u.uBoatPos.value.copy(boatPos);
      u.uBoatFwd.value.copy(fwd);
      u.uSpeed.value = speed;
      u.uThrottle.value = throttle;
      u.uHeave.value = heave;
      u.uTime.value = time;
      this.idx ^= 1;
      this.renderer.setRenderTarget(this.rt[this.idx]);
      this.renderer.render(this.scene, this.cam);
    }
    this.renderer.setRenderTarget(null);
  }
}

export const WAKE_GLSL = /* glsl */ `
uniform sampler2D tWake;
uniform vec2 uWakeCenter;
uniform float uWakeSize, uWakeTexel;
vec2 wakeUV(vec2 xz){ return (xz - uWakeCenter) / uWakeSize + 0.5; }
vec4 wakeSample(vec2 xz){
  vec2 uv = wakeUV(xz);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(tWake, uv);
}
`;
