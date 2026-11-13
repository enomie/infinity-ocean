import * as THREE from 'three';
import type { VesselSpec } from './types';
import { box, buildHull, cyl, mat } from './hull';

/** 8 — sailing catamaran: two slim hulls, very stable (little heel), quick on a reach */
export const catamaran: VesselSpec = {
  name: 'Katamaran', len: 13, beam: 7,
  maxSpeed: 11, reverse: 0.15, accel: 0.22, turnRate: 0.4, turnMinSpeed: 2.5,
  heave: 24, damping: 5, rollStiff: 40, rollDamp: 6, turnHeel: 0, squat: 0.003,
  sail: true,
  screws: { x: [-2.7, 2.7], y: -0.55, z: 6.65, r: 0.22, blades: 3 },
  camDist: 30, camHeight: 5,
  build(env) {
    const group = new THREE.Group();
    for (const sx of [-1, 1]) {
      const { group: h } = buildHull({ len: 13, beam: 1.6, draft: 0.8, free: 1.1, bowRise: 0.2, bowLen: 0.55, sternW: 0.7,
        bottom: 0x1a1a1a, stripe: 0x0a6aa0, top: 0xf2f2ee, deck: 0xe8e6de }, env);
      h.position.x = sx * 2.7;
      group.add(h);
    }
    const white = mat(env, 0xeeeeea, 0.35), glass = mat(env, 0x0d1822, 0.05, 0.5), alu = mat(env, 0xb8bcc0, 0.3, 0.8);
    const net = mat(env, 0x30353a, 0.9);
    group.add(box(white, 7, 0.35, 7.5, 0, 1.0, 1.5), box(net, 5, 0.04, 4.5, 0, 1.1, -4.2));
    group.add(box(white, 5, 1.4, 4.5, 0, 1.35, 1.7), box(glass, 5.05, 0.6, 4.2, 0, 1.9, 1.7));
    group.add(cyl(alu, 0.11, 17, 0, 2.7, -0.6, 0.14));
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.8, side: THREE.DoubleSide, envMap: env });
    const tri = (p: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.computeVertexNormals();
      return new THREE.Mesh(g, sailMat);
    };
    const sails = new THREE.Group();
    sails.name = 'sails';
    sails.add(tri([0, 3.2, -0.5, 0, 19.3, -0.55, 0, 3.2, 4.4]), tri([0, 1.4, -6.4, 0, 17, -0.8, 0, 1.6, -1.0]));
    group.add(sails);
    return group;
  },
};
