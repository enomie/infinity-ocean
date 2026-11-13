import type { VesselSpec } from './types';
import { box, buildHull, cyl, mat } from './hull';

/** 6 — aircraft carrier: huge flat deck, island to starboard */
export const carrier: VesselSpec = {
  name: 'Flugzeugträger', len: 320, beam: 40,
  maxSpeed: 15, reverse: 0.3, accel: 0.02, turnRate: 0.045, turnMinSpeed: 4,
  heave: 2.5, damping: 2.2, rollStiff: 2, rollDamp: 1.4, turnHeel: 0.0015, squat: 0.0004,
  screws: { x: [-10, 0, 10], y: -7.5, z: 162, r: 3.4, blades: 5 },
  camDist: 330, camHeight: 25,
  build(env) {
    const { group } = buildHull({ len: 320, beam: 40, draft: 11, free: 17, bowRise: 2, bowLen: 0.3, sternW: 0.9,
      bottom: 0x3a1010, stripe: 0x1a1a1a, top: 0x5e666c, deck: 0x3a3e42, boot: 1.2 }, env);
    const grey = mat(env, 0x6e767c, 0.55), deck = mat(env, 0x34383c, 0.85), line = mat(env, 0xd8d8c8, 0.7), dark = mat(env, 0x25292c, 0.5);
    // overhanging flight deck
    group.add(box(deck, 76, 2, 330, 6, 17, -2), box(grey, 60, 4, 300, 6, 13, -2));
    group.add(box(line, 1, 0.1, 300, 6, 19, -2));
    const angled = box(line, 1, 0.1, 200, 0, 19, 20); angled.rotation.y = 0.15; group.add(angled);
    // island
    group.add(box(grey, 10, 18, 40, 36, 19, 40), box(grey, 8, 8, 24, 36, 37, 38), cyl(dark, 0.6, 16, 36, 45, 36));
    // parked jets
    for (let i = 0; i < 8; i++) {
      const j = box(dark, 10, 1.6, 15, -24 + (i % 2) * 12, 19, -120 + i * 18);
      j.rotation.y = 0.6; group.add(j);
      group.add(box(dark, 3, 3, 1.5, j.position.x, 19, j.position.z + 6));
    }
    return group;
  },
};
