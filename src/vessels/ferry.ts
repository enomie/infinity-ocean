import type { VesselSpec } from './types';
import { box, buildHull, cyl, mat } from './hull';

/** 9 — car ferry (RoPax): tall, boxy, high windage → rolls slowly, moderate speed */
export const ferry: VesselSpec = {
  name: 'Autofähre', len: 120, beam: 24,
  maxSpeed: 11, reverse: 0.5, accel: 0.05, turnRate: 0.08, turnMinSpeed: 3,
  heave: 5, damping: 3, rollStiff: 2.5, rollDamp: 0.9, turnHeel: 0.004, squat: 0.0008,
  screws: { x: [-6, 6], y: -3.8, z: 61.2, r: 2.0, blades: 4 },
  camDist: 150, camHeight: 15,
  build(env) {
    const { group } = buildHull({ len: 120, beam: 24, draft: 5.5, free: 8, bowRise: 2.5, bowLen: 0.3, sternW: 0.95,
      bottom: 0x2a3a6a, stripe: 0x1a4aa8, top: 0xf0f0ec, deck: 0x6a7078, boot: 0.8 }, env);
    const white = mat(env, 0xf2f2ee, 0.45), blue = mat(env, 0x1a4aa8, 0.4), glass = mat(env, 0x14202c, 0.08, 0.5);
    const yellow = mat(env, 0xf0c020, 0.5);
    // superstructure decks with window bands
    group.add(box(white, 23, 9, 80, 0, 7.8, 8), box(glass, 23.2, 2, 78, 0, 11, 8));
    group.add(box(white, 21, 5, 60, 0, 16.8, 2), box(glass, 21.2, 1.6, 58, 0, 18.5, 2));
    group.add(box(white, 23, 4, 10, 0, 21.8, -26), box(glass, 23.2, 1.8, 0.4, 0, 23, -31.1)); // bridge
    group.add(box(blue, 23.2, 1.6, 80, 0, 9, 8));                                               // logo band
    for (const sx of [-1, 1]) group.add(cyl(blue, 2, 9, sx * 4, 21.8, 22, 2.4), cyl(mat(env, 0x111111, 0.6), 2.05, 1.2, sx * 4, 30.6, 22));
    // lifeboats
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) group.add(box(yellow, 2, 2, 7, sx * 11.6, 16, -16 + i * 9));
    // stern ramp
    group.add(box(mat(env, 0x3a3e44, 0.7), 14, 7, 0.6, 0, 7.8, 60.2));
    return group;
  },
};
