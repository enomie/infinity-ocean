import type { VesselSpec } from './types';
import { box, buildHull, cyl, mat } from './hull';

/** 5 — destroyer: long, slim, fast, heels outward in hard turns */
export const destroyer: VesselSpec = {
  name: 'Zerstörer', len: 150, beam: 19,
  maxSpeed: 16, reverse: 0.35, accel: 0.04, turnRate: 0.09, turnMinSpeed: 4,
  heave: 5, damping: 3, rollStiff: 4, rollDamp: 1.2, turnHeel: 0.0035, squat: 0.0012,
  camDist: 160, camHeight: 12,
  build(env) {
    const { group } = buildHull({ len: 150, beam: 19, draft: 6.5, free: 6, bowRise: 4, bowLen: 0.4, sternW: 0.85,
      bottom: 0x3a1010, stripe: 0x1a1a1a, top: 0x6e767c, deck: 0x50575c, boot: 0.8 }, env);
    const grey = mat(env, 0x7a8288, 0.55), dark = mat(env, 0x30353a, 0.5);
    group.add(box(grey, 15, 9, 30, 0, 6, -12), box(grey, 11, 6, 14, 0, 15, -14), box(grey, 13, 2, 6, 0, 21, -18));
    group.add(cyl(dark, 0.8, 22, 0, 21, -10, 1.2), box(grey, 12, 8, 22, 0, 6, 28), cyl(grey, 3, 9, 0, 14, 22, 3.4));
    const turret = (z: number) => {
      group.add(cyl(grey, 3.5, 2.5, 0, 6.5, z));
      const barrel = cyl(dark, 0.3, 9, 0, 0, 0); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 7.8, z - 6); group.add(barrel);
    };
    turret(-48);
    group.add(box(dark, 8, 0.6, 10, 0, 6.2, -34), box(grey, 10, 3, 10, 0, 6, 55));
    return group;
  },
};
