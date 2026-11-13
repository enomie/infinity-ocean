import * as THREE from 'three';
import { createSky, SkyCube, skyUniforms, SUN_DIR } from './sky';
import { createOcean } from './ocean';
import { phaseUniform, updateWavePhases, waveHeight, waveUniform } from './waves';
import { Wake } from './wake';
import { Vessel } from './boat';
import { VESSELS } from './vessels';
import { createPost } from './post';
import { MarineLife } from './fauna/fish';
import { islandSeedUniform, islandUniform, World } from './world';
import { ORIGIN, SHIFT_SNAP, SHIFT_THRESHOLD } from './world/origin';
import { Gulls } from './fauna/birds';
import { Bubbles, createDrift, setParticleViewport, Spray } from './particles';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const params = new URLSearchParams(location.search);
const maxRatio = Math.min(window.devicePixelRatio, Number(params.get('q') ?? 1.5));
let ratio = maxRatio;
renderer.setPixelRatio(ratio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 20000);
const scene = new THREE.Scene();

const wake = new Wake(renderer);
const sky = skyUniforms();
const skyCube = new SkyCube(renderer, sky);
sky.tSkyCube.value = skyCube.rt.texture;
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
  uIsl: { value: islandUniform },
  uIslSeed: { value: islandSeedUniform },
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

const world = new World(env);
scene.add(world.group);
// distance haze for land (water has its own aerial perspective)
scene.fog = new THREE.FogExp2(new THREE.Color(0.62, 0.72, 0.82), 0.00016);
const life = new MarineLife(env);
const gulls = new Gulls(env, world);
scene.add(gulls.mesh);
scene.add(life.group);
const drift = createDrift(shared);
const spray = new Spray();
const bubbles = new Bubbles();
scene.add(drift.mesh, spray.mesh, bubbles.mesh);
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
(window as any).__dbg = { get boat() { return boat; }, camera, waveHeight, shared, life, gulls, world, ORIGIN, wake, skyCube, scene };

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
  const m = /^(Digit|Numpad)([0-9])$/.exec(e.code);
  if (m) selectVessel((Number(m[2]) + 9) % 10);
});
addEventListener('keyup', (e) => keys.delete(e.code));
const orbit = {
  yaw: Number(params.get('yaw') ?? 2.6),
  pitch: Number(params.get('pitch') ?? 0.18),
  dist: Number(params.get('dist') ?? 18),
};
let drag = false;
if (params.get('auto')) keys.add('KeyW');
if (params.get('dive')) keys.add('ArrowDown');
if (params.get('x')) boat.pos.set(Number(params.get('x')), Number(params.get('z') ?? 0));
if (params.get('h')) boat.heading = Number(params.get('h'));
if (params.get('v')) selectVessel((Number(params.get('v')) + 9) % 10);
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
/**
 * Floating origin: when the vessel strays too far from (0,0) the whole world is
 * re-centred in SHIFT_SNAP steps. Absolute position = local + ORIGIN.
 */
function maybeShiftOrigin() {
  if (Math.hypot(boat.pos.x, boat.pos.y) < SHIFT_THRESHOLD) return;
  const dx = Math.round(boat.pos.x / SHIFT_SNAP) * SHIFT_SNAP;
  const dz = Math.round(boat.pos.y / SHIFT_SNAP) * SHIFT_SNAP;
  ORIGIN.x += dx; ORIGIN.z += dz;
  boat.shift(dx, dz);
  wake.shift(dx, dz);
  life.shift(dx, dz);
  gulls.shift(dx, dz);
  spray.shift(dx, dz);
  bubbles.shift(dx, dz);
  camera.position.x -= dx; camera.position.z -= dz;
  camXZ.x -= dx; camXZ.y -= dz;
  world.onOriginShift();
}

// stream in the islands around the start before the first frame
for (let i = 0; i < 40; i++) world.update(0, new THREE.Vector3(boat.pos.x, 5, boat.pos.y), 60);

// ?warp=N : pre-simulate N seconds (for screenshots / testing)
for (let i = 0, n = Number(params.get('warp') ?? 0) * 60; i < n; i++) {
  t += 1 / 60;
  shared.uTime.value = t;
  maybeShiftOrigin();
  boat.update(1 / 60, t, keys, camXZ);
  camXZ.copy(boat.pos);
  wake.update(1 / 60, boat.pos, boat.forward, boat.speed, boat.throttle, boat.heave, t);
  life.update(1 / 60, t, boat.group.position, new THREE.Vector3(boat.pos.x, -5, boat.pos.y));
  gulls.update(1 / 60, t, new THREE.Vector3(boat.pos.x, 10, boat.pos.y), boat.group.position, camXZ);
  spray.update(1 / 60, boat, bubbles);
  bubbles.update(1 / 60, t, boat);
  if (i % 30 === 0) world.update(t, new THREE.Vector3(boat.pos.x, 5, boat.pos.y), 20);
}
for (let i = 0; i < 20; i++) world.update(t, new THREE.Vector3(boat.pos.x, 5, boat.pos.y), 60);

function step(dt: number) {
  t += dt;
  shared.uTime.value = t;
  maybeShiftOrigin();
  updateWavePhases(t);
  sky.uSkyTime.value = t;

  boat.update(dt, t, keys, camXZ);
  const fwd = boat.forward;
  wake.update(dt, boat.pos, fwd, boat.speed, boat.throttle, boat.heave, t, boat.surfaceContact);
  shared.tWake.value = wake.texture;
  skyCube.update();
  life.update(dt, t, boat.group.position, camera.position);
  world.update(t, camera.position);
  gulls.update(dt, t, camera.position, boat.group.position, camXZ);
  spray.update(dt, boat, bubbles);
  bubbles.update(dt, t, boat);

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
  drift.update(camera.position);
  setParticleViewport(size.y);

  sun.position.copy(target).addScaledVector(SUN_DIR, 100);
  sun.target.position.copy(target);

  const above = camera.position.y - waveHeight(camera.position.x, camera.position.z, t, camXZ);
  spray.mesh.visible = above > 0; // airborne spray isn't refracted → hide when looking from below
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  const pu = post.mat.uniforms;
  pu.uInvProj.value.copy(camera.projectionMatrixInverse);
  pu.uCamWorld.value.copy(camera.matrixWorld);
  pu.uCamPos.value.copy(camera.position);
  pu.uRes.value.copy(size);
  pu.uLensMode.value = above > 2.5 ? 0 : above < -2.5 ? 2 : 1;
  renderer.render(post.scene, post.cam);
  // propeller wash cloud: soft overlay after tonemapping (manual depth test against the scene)
  bubbles.setDepth(rt.depthTexture!, size);
  renderer.autoClear = false;
  renderer.render(bubbles.overlay, camera);
  renderer.autoClear = true;

}

// dynamic resolution: drop quickly below 115 fps, recover slowly
// target = display refresh (best rate seen, capped at 120) so 60 Hz screens don't degrade
let goodTime = 0, bestFps = 0;
function adaptResolution(f: number) {
  if (params.get('q') || document.hidden) return;
  bestFps = Math.max(bestFps, Math.min(f, 125));
  const target = Math.min(bestFps, 120);
  let next = ratio;
  if (f < target * 0.94) { next = Math.max(0.6, ratio * 0.9); goodTime = 0; }
  else if (f > target * 0.98 && (goodTime += 0.5) > 4) { next = Math.min(maxRatio, ratio * 1.05); goodTime = 0; }
  if (Math.abs(next - ratio) > 0.01) {
    ratio = next;
    renderer.setPixelRatio(ratio);
    renderer.getDrawingBufferSize(size);
    rt.setSize(size.x, size.y);
  }
}

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  step(dt);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
    adaptResolution(fps);
  }
  hud.textContent = `0–9 Schiff · ${boat.spec.name}${boat.spec.sail ? ' (W: Segel dicht)' : ''}${boat.spec.submarine ? ` · ↓ tauchen ↑ auftauchen · Tiefe ${boat.depth.toFixed(0)} m` : ''} · W/S Gas · A/D Ruder · Maus ziehen: Kamera · Rad: Zoom (unter Wasser: nach unten ziehen)   ${fps.toFixed(0)} fps @${(ratio * 100).toFixed(0)}% · ${boat.speed.toFixed(1)} m/s · Pos ${((boat.pos.x + ORIGIN.x) / 1000).toFixed(2)} / ${((boat.pos.y + ORIGIN.z) / 1000).toFixed(2)} km`;
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

/** __gpu(n): true GPU time per frame via EXT_disjoint_timer_query_webgl2 (+ CPU time of step) */
(window as any).__gpu = async (n = 60) => {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return 'no timer extension';
  const qs: WebGLQuery[] = [];
  let cpu = 0;
  for (let i = 0; i < n; i++) {
    const q = gl.createQuery()!;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    const c0 = performance.now();
    step(1 / 120);
    cpu += performance.now() - c0;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    qs.push(q);
  }
  gl.finish();
  await new Promise((r) => setTimeout(r, 50));
  let sum = 0, got = 0;
  for (const q of qs) {
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { sum += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; got++; }
    gl.deleteQuery(q);
  }
  const gpu = got ? sum / got : NaN;
  return { gpuMs: +gpu.toFixed(2), cpuMs: +(cpu / n).toFixed(2), estFps: Math.round(1000 / Math.max(gpu, cpu / n)), px: `${size.x}x${size.y}`, samples: got };
};
