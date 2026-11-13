import * as THREE from 'three';
import type { VesselSpec } from './types';
import { box, buildHull, cyl, mat, merged, paintMaterial, railing, rod } from './hull';

/**
 * Superstructure livery: flat navy grey with crisp window bands (ship-local y),
 * windows only on vertical faces. Bridge gets tall, slanted-looking glazing.
 */
const WINDOWS = /* glsl */ `
  vec3 n = normalize(vObjN);
  if (abs(n.y) < 0.5) {
    float u = abs(n.z) > 0.5 ? p.x : p.z;            // along the face
    float pane = aa(0.22, fract(u / 1.7)) * (1.0 - aa(0.86, fract(u / 1.7)));
    float bridge = aa(18.3, p.y) * (1.0 - aa(20.2, p.y)) * aa(0.12, fract(u / 1.3)) * (1.0 - aa(0.94, fract(u / 1.3)));
    float deck1 = aa(10.6, p.y) * (1.0 - aa(11.6, p.y)) * pane;
    float deck2 = aa(13.0, p.y) * (1.0 - aa(13.8, p.y)) * pane * step(0.0, p.z); // aft block, portholes row
    float w = max(bridge, max(deck1, deck2));
    c = mix(c, vec3(0.025, 0.04, 0.055), w);
    c = mix(c, vec3(0.32, 0.35, 0.37), aa(20.9, p.y) * (1.0 - aa(21.25, p.y))); // dark top trim of the bridge
  }
`;

/** 5 — destroyer: long, slim, fast, heels outward in hard turns */
export const destroyer: VesselSpec = {
  name: 'Zerstörer', len: 150, beam: 19,
  maxSpeed: 16, reverse: 0.35, accel: 0.04, turnRate: 0.09, turnMinSpeed: 4,
  heave: 5, damping: 3, rollStiff: 4, rollDamp: 1.2, turnHeel: 0.0035, squat: 0.0012,
  screws: { x: [-4, 4], y: -4.4, z: 76.4, r: 2.2, blades: 5 },
  camDist: 160, camHeight: 12,
  build(env) {
    const { group, halfW, sheer } = buildHull({ len: 150, beam: 19, draft: 6.5, free: 6, bowRise: 4, bowLen: 0.4, sternW: 0.85,
      bottom: 0x3a1010, stripe: 0x1a1a1a, top: 0x6e767c, deck: 0x50575c, boot: 0.8 }, env);
    const grey = mat(env, 0x7a8288, 0.55), dark = mat(env, 0x30353a, 0.5, 0.2);
    const superMat = paintMaterial(env, WINDOWS, {}, { color: 0x7a8288, roughness: 0.55 });

    // superstructure blocks → one draw call, painted with windows
    group.add(merged(superMat, [
      box(grey, 15, 9, 30, 0, 6, -12), box(grey, 11, 6, 14, 0, 15, -14), box(grey, 13, 0.6, 6, 0, 20.8, -18),
      box(grey, 12, 8, 22, 0, 6, 28), box(grey, 10, 3, 10, 0, 6, 55),
    ]));

    // armament + funnel → one draw call
    const arms: THREE.Mesh[] = [cyl(grey, 3, 9, 0, 14, 22, 3.4), cyl(grey, 3.5, 2.5, 0, 6.5, -48)];
    const barrel = cyl(dark, 0.3, 9, 0, 0, 0); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 7.8, -54); arms.push(barrel);
    arms.push(box(dark, 8, 0.6, 10, 0, 6.2, -34));
    group.add(merged(grey, arms.slice(0, 2)), merged(dark, arms.slice(2)));

    // lattice mast: 4 tapered legs, X-bracing, yardarm, radar, antennas → one draw call
    const mast: THREE.Mesh[] = [];
    const mz = -10, y0 = 21, H = 20;
    const leg = (k: number, h: number) => { const w = 1.6 * (1 - h / H) + 0.35; return new THREE.Vector3((k & 1 ? 1 : -1) * w, y0 + h, mz + (k & 2 ? 1 : -1) * w); };
    const levels = [0, 4, 8, 12, 16, H];
    for (let k = 0; k < 4; k++) mast.push(rod(leg(k, 0), leg(k, H), 0.14, 6));
    const ring = [0, 1, 3, 2];
    for (let l = 0; l < levels.length - 1; l++)
      for (let i = 0; i < 4; i++) {
        const a = ring[i], b = ring[(i + 1) % 4];
        mast.push(rod(leg(a, levels[l]), leg(b, levels[l + 1]), 0.06), rod(leg(b, levels[l]), leg(a, levels[l + 1]), 0.06));
        mast.push(rod(leg(a, levels[l + 1]), leg(b, levels[l + 1]), 0.07));
      }
    // platforms, yardarm, top pole
    mast.push(box(dark, 4.4, 0.25, 4.4, 0, y0 + 8, mz), box(dark, 2.6, 0.25, 2.6, 0, y0 + 16, mz));
    mast.push(rod(new THREE.Vector3(-7, y0 + 14, mz), new THREE.Vector3(7, y0 + 14, mz), 0.12, 6));
    mast.push(rod(new THREE.Vector3(0, y0 + H, mz), new THREE.Vector3(0, y0 + H + 9, mz), 0.12, 6));
    for (const sx of [-6, -3, 3, 6]) mast.push(rod(new THREE.Vector3(sx, y0 + 14, mz), new THREE.Vector3(sx, y0 + 12.4, mz), 0.04));
    // rotating-style radar array on the upper platform, radome on the yard
    const radar = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.1, 0.35)); radar.position.set(0, y0 + 17.2, mz); mast.push(radar);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8)); dome.position.set(0, y0 + 9.4, mz); mast.push(dome);
    for (const sx of [-1.8, 1.8]) {
      const d2 = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 6)); d2.position.set(sx, y0 + 15, mz); mast.push(d2);
    }
    group.add(merged(dark, mast));
    // radome: light grey contrast
    const radome = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(env, 0xd8dcde, 0.4));
    radome.position.set(0, 21.4, -18);
    group.add(radome);

    // deck railing around the whole main deck → one draw call
    group.add(railing(dark, 150, halfW, sheer, { spacing: 2.4, height: 1.15, r: 0.05, inset: 0.3 }));
    return group;
  },
};
