import type { VesselSpec } from './types';
import { box, buildHull, cyl, mat } from './hull';

/** 2 — planing speedboat: fast, nimble, leans into turns */
export const speedboat: VesselSpec = {
  name: 'Speedboot', len: 7, beam: 2.3,
  maxSpeed: 24, reverse: 0.2, accel: 0.6, turnRate: 1.1, turnMinSpeed: 4,
  heave: 40, damping: 7, rollStiff: 40, rollDamp: 5, turnHeel: 0.012, squat: 0.008,
  planing: true,
  camDist: 15, camHeight: 1.0,
  build(env) {
    const { group } = buildHull({ len: 7, beam: 2.3, draft: 0.45, free: 0.75, bowRise: 0.25, bowLen: 0.55, sternW: 0.95,
      bottom: 0x111111, stripe: 0xd01818, top: 0xe8e8e8, deck: 0xdedad0 }, env);
    const glass = mat(env, 0x101820, 0.05, 0.5), seat = mat(env, 0x30261c, 0.6), black = mat(env, 0x111111, 0.4);
    const ws = box(glass, 2.0, 0.45, 0.04, 0, 0.7, -0.6); ws.rotation.x = -0.9; group.add(ws);
    group.add(box(seat, 1.7, 0.35, 1.2, 0, 0.72, 0.6), box(seat, 1.7, 0.6, 0.25, 0, 0.72, 1.3));
    group.add(box(black, 0.6, 0.9, 0.5, 0, 0.0, 3.7), cyl(black, 0.05, 0.6, 0, -0.6, 3.75));
    return group;
  },
};
