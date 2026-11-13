import * as THREE from 'three';
import { createSky, skyUniforms, SUN_DIR } from './sky';
import { createOcean } from './ocean';
import { phaseUniform, waveHeight, waveUniform } from './waves';
import { Wake } from './wake';
import { Vessel } from './boat';
import { VESSELS } from './vessels';
import { createPost } from './post';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 20000);
const scene = new THREE.Scene();

const wake = new Wake(renderer);
const sky = skyUniforms();
const shared: Record<string, THREE.IUniform> = {
  ...sky,
  uWaves: { value: waveUniform },
  uPhase: { value: phaseUniform },
  uTime: { value: 0 },
  uCamXZ: { value: new THREE.Vector2() },
  tWake: { value: wake.texture },
  uWakeCenter: { value: wake.center },
  uWakeSize: { value: wake.size },
  uWakeTexel: { value: wake.texel },
};

const skyMesh = createSky(sky);
scene.add(skyMesh);
scene.add(createOcean(shared));

// environment map for the boat, rendered from the sky shader
const envScene = new THREE.Scene();
envScene.add(createSky(sky));
const pmrem = new THREE.PMREMGenerator(renderer);
const env = pmrem.fromScene(envScene, 0, 0.1, 2000).texture;

const sun = new THREE.DirectionalLight(0xffe2c0, 2.4);
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x1a3040, 0.5));

let boat = new Vessel(VESSELS[0], env);
scene.add(boat.group);
wake.setVessel(boat.spec.len, boat.spec.beam);
function selectVessel(i: number) {
  const spec = VESSELS[i];
  if (!spec || spec === boat.spec) return;
  const next = new Vessel(spec, env);
  next.takeOver(boat);
  scene.remove(boat.group);
  boat.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  boat = next;
  scene.add(boat.group);
  wake.setVessel(spec.len, spec.beam);
  shared.uWakeSize.value = wake.size;
  shared.uWakeTexel.value = wake.texel;
  orbit.dist = spec.camDist;
}
(window as any).__dbg = { boat, camera, waveHeight, shared };

// render target with depth for the post pass
const size = new THREE.Vector2();
renderer.getDrawingBufferSize(size);
const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
  type: THREE.HalfFloatType,
  samples: 4,
  depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType),
});
const post = createPost(shared);
post.mat.uniforms.tColor.value = rt.texture;
post.mat.uniforms.tDepth.value = rt.depthTexture;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.getDrawingBufferSize(size);
  rt.setSize(size.x, size.y);
});

// --- input / orbit camera ---
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  const m = /^(Digit|Numpad)([1-6])$/.exec(e.code);
  if (m) selectVessel(Number(m[2]) - 1);
});
addEventListener('keyup', (e) => keys.delete(e.code));
const params = new URLSearchParams(location.search);
const orbit = {
  yaw: Number(params.get('yaw') ?? 2.6),
  pitch: Number(params.get('pitch') ?? 0.18),
  dist: Number(params.get('dist') ?? 18),
};
let drag = false;
if (params.get('auto')) keys.add('KeyW');
if (params.get('v')) selectVessel(Number(params.get('v')) - 1);
if (!params.get('dist')) orbit.dist = boat.spec.camDist;
renderer.domElement.addEventListener('pointerdown', () => (drag = true));
addEventListener('pointerup', () => (drag = false));
addEventListener('pointermove', (e) => {
  if (!drag) return;
  orbit.yaw -= e.movementX * 0.005;
  orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + e.movementY * 0.004, -0.9, 1.4);
});
addEventListener('wheel', (e) => (orbit.dist = THREE.MathUtils.clamp(orbit.dist * (1 + e.deltaY * 0.001), 3, boat.spec.camDist * 4)));

const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;left:14px;bottom:12px;color:#fff;font:12px/1.5 system-ui;opacity:.75;text-shadow:0 1px 2px #0008;pointer-events:none';
document.body.appendChild(hud);

const camXZ = shared.uCamXZ.value as THREE.Vector2;
const clock = new THREE.Clock();
let t = Number(params.get('t') ?? 0);
let fpsAcc = 0, fpsN = 0, fps = 0;

const ty = params.get('ty') !== null ? Number(params.get('ty')) : null;
// ?warp=N : pre-simulate N seconds (for screenshots / testing)
for (let i = 0, n = Number(params.get('warp') ?? 0) * 60; i < n; i++) {
  t += 1 / 60;
  shared.uTime.value = t;
  boat.update(1 / 60, t, keys, camXZ);
  camXZ.copy(boat.pos);
  wake.update(1 / 60, boat.pos, boat.forward, boat.speed, boat.throttle, boat.heave, t);
}

function step(dt: number) {
  t += dt;
  shared.uTime.value = t;
  sky.uSkyTime.value = t;

  boat.update(dt, t, keys, camXZ);
  const fwd = boat.forward;
  wake.update(dt, boat.pos, fwd, boat.speed, boat.throttle, boat.heave, t);
  shared.tWake.value = wake.texture;

  // camera: orbit around boat; follow heading softly when moving
  const target = new THREE.Vector3(boat.pos.x, ty ?? boat.group.position.y + boat.spec.camHeight, boat.pos.y);
  const cp = Math.cos(orbit.pitch);
  camera.position.set(
    target.x + Math.sin(orbit.yaw) * cp * orbit.dist,
    target.y + Math.sin(orbit.pitch) * orbit.dist,
    target.z + Math.cos(orbit.yaw) * cp * orbit.dist,
  );
  camera.lookAt(target);
  camera.updateMatrixWorld();
  camXZ.set(camera.position.x, camera.position.z);
  skyMesh.position.copy(camera.position);

  sun.position.copy(target).addScaledVector(SUN_DIR, 100);
  sun.target.position.copy(target);

  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  const pu = post.mat.uniforms;
  pu.uInvProj.value.copy(camera.projectionMatrixInverse);
  pu.uCamWorld.value.copy(camera.matrixWorld);
  pu.uCamPos.value.copy(camera.position);
  pu.uRes.value.copy(size);
  renderer.render(post.scene, post.cam);

}

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  step(dt);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  hud.textContent = `1–6 Schiff · ${boat.spec.name}${boat.spec.sail ? ' (W: Segel dicht)' : ''} · W/S Gas · A/D Ruder · Maus ziehen: Kamera · Rad: Zoom (unter Wasser: nach unten ziehen)   ${fps.toFixed(0)} fps · ${boat.speed.toFixed(1)} m/s`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** __bench(n): ms per frame incl. GPU (forced sync), at current resolution */
(window as any).__bench = (n = 120) => {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  for (let i = 0; i < 10; i++) step(1 / 120);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { step(1 / 120); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  const ms = (performance.now() - t0) / n;
  return { ms: +ms.toFixed(2), fps: Math.round(1000 / ms), px: `${size.x}x${size.y}` };
};
