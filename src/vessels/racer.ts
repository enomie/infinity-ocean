import * as THREE from 'three';
import type { VesselSpec } from './types';
import { box, buildHull, mat } from './hull';

/** 7 — F1 powerboat (tunnel hull): brutal acceleration, fast flat turns */
export const racer: VesselSpec = {
  name: 'Rennboot F1', len: 6, beam: 2.1,
  maxSpeed: 55, reverse: 0.1, accel: 0.9, turnRate: 1.6, turnMinSpeed: 6,
  heave: 60, damping: 9, rollStiff: 60, rollDamp: 8, turnHeel: 0.006, squat: 0.002,
  planing: true,
  screws: { x: [0], y: -0.32, z: 3.32, r: 0.17, blades: 3 },
  camDist: 16, camHeight: 0.8,
  build(env) {
    const group = new THREE.Group();
    const red = mat(env, 0xd01010, 0.25, 0.1), white = mat(env, 0xf0f0f0, 0.3), black = mat(env, 0x111111, 0.35);
    const glass = mat(env, 0x1a2a3a, 0.05, 0.6);
    // two sponsons with a tunnel in between
    for (const sx of [-1, 1]) {
      const { group: h } = buildHull({ len: 6, beam: 0.55, draft: 0.25, free: 0.35, bowRise: 0.1, bowLen: 0.6, sternW: 1,
        bottom: 0x111111, stripe: 0xd01010, top: 0xf0f0f0, deck: 0xd01010 }, env);
      h.position.x = sx * 0.78;
      group.add(h);
    }
    group.add(box(white, 1.9, 0.08, 4.6, 0, 0.36, 0.5));           // tunnel deck / wing
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 2.2, 6, 12), red);
    pod.rotation.x = Math.PI / 2; pod.scale.set(1, 1, 0.7); pod.position.set(0, 0.55, 0.3);
    group.add(pod);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    canopy.scale.set(1, 0.8, 1.6); canopy.position.set(0, 0.75, -0.2);
    group.add(canopy);
    group.add(box(black, 0.7, 0.5, 0.9, 0, 0.5, 2.6), box(black, 0.15, 0.9, 0.3, 0, -0.4, 3.05));  // engine + leg
    group.add(box(red, 1.9, 0.06, 0.5, 0, 0.85, 2.7), box(black, 0.06, 0.45, 0.4, 0, 0.42, 2.7)); // rear wing
    return group;
  },
};
