import type { VesselSpec } from './types';
import { box, buildHull, cyl, mat } from './hull';

/** 4 — VLCC oil tanker: enormous inertia, glacial turns */
export const tanker: VesselSpec = {
  name: 'Öltanker', len: 240, beam: 42,
  maxSpeed: 7.5, reverse: 0.3, accel: 0.012, turnRate: 0.035, turnMinSpeed: 2,
  heave: 3, damping: 2.5, rollStiff: 2, rollDamp: 1.6, turnHeel: 0.001, squat: 0.0006,
  camDist: 240, camHeight: 20,
  build(env) {
    const { group } = buildHull({ len: 240, beam: 42, draft: 16, free: 9, bowRise: 3, bowLen: 0.18, sternW: 0.92,
      bottom: 0x5a1410, stripe: 0x5a1410, top: 0x1c2a3a, deck: 0x5a6a50, boot: 1.5 }, env);
    const white = mat(env, 0xd8d8d2, 0.5), red = mat(env, 0x8a2016, 0.6), pipe = mat(env, 0x6a7a5c, 0.6);
    group.add(box(white, 34, 12, 14, 0, 9, 98), box(white, 26, 10, 10, 0, 21, 99), box(white, 40, 1, 6, 0, 31, 96));
    group.add(cyl(red, 3, 14, 0, 21, 110));
    for (let z = -95; z < 85; z += 22) group.add(box(pipe, 30, 1.5, 3, 0, 9, z));
    group.add(box(pipe, 2, 2, 190, -4, 9, -5), box(pipe, 2, 2, 190, 4, 9, -5));
    return group;
  },
};
