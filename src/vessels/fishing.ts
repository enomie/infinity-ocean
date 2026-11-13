import type { VesselSpec } from './types';
import { box, buildHull, cyl, mat } from './hull';

/** 1 — small motor cruiser */
export const fishing: VesselSpec = {
  name: 'Motorboot', len: 9, beam: 2.9,
  maxSpeed: 9, reverse: 0.4, accel: 0.35, turnRate: 0.75, turnMinSpeed: 3,
  heave: 26, damping: 6, rollStiff: 24, rollDamp: 3.5, turnHeel: -0.012, squat: 0.012,
  screws: { x: [0], y: -0.5, z: 4.72, r: 0.3 },
  camDist: 18, camHeight: 1.2,
  build(env) {
    const { group } = buildHull({ len: 9, beam: 2.9, draft: 0.75, free: 1.0, bowRise: 0.55 }, env);
    const white = mat(env, 0xc8c8c2, 0.35), glass = mat(env, 0x0b1620, 0.05, 0.4), chrome = mat(env, 0xcccccc, 0.15, 1);
    group.add(box(white, 1.9, 0.75, 2.6, 0, 1.08, 0.2), box(white, 2.05, 0.08, 3.1, 0, 1.82, 0.35));
    const ws = box(glass, 1.75, 0.5, 0.05, 0, 1.25, -1.12); ws.rotation.x = -0.45; group.add(ws);
    group.add(box(glass, 1.92, 0.36, 1.8, 0, 1.33, 0.2), cyl(chrome, 0.03, 1.2, 0, 1.9, 1.3));
    return group;
  },
};
