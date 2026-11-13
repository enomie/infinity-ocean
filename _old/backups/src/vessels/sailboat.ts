import * as THREE from 'three';
import type { VesselSpec } from './types';
import { box, buildHull, cyl, mat } from './hull';

/** 3 — sloop: speed depends on wind angle, heels with the wind */
export const sailboat: VesselSpec = {
  name: 'Segelboot', len: 11, beam: 3.4,
  maxSpeed: 7.5, reverse: 0.15, accel: 0.18, turnRate: 0.45, turnMinSpeed: 2,
  heave: 22, damping: 5, rollStiff: 14, rollDamp: 3, turnHeel: 0, squat: 0.004,
  sail: true,
  camDist: 26, camHeight: 4,
  build(env) {
    const { group } = buildHull({ len: 11, beam: 3.4, draft: 0.9, free: 0.9, bowRise: 0.3, bowLen: 0.5, sternW: 0.75,
      bottom: 0x0c2240, stripe: 0x0c2240, top: 0xeeeeea, deck: 0xb0905c }, env);
    const white = mat(env, 0xdedcd6, 0.4), alu = mat(env, 0xb0b4b8, 0.3, 0.8);
    group.add(box(white, 2.0, 0.45, 3.0, 0, 0.88, 0.5));
    group.add(cyl(alu, 0.08, 15, 0, 0.9, -0.6, 0.1));
    const boom = cyl(alu, 0.06, 4.4, 0, 0, 0); boom.rotation.x = Math.PI / 2; boom.position.set(0, 2.2, 1.6); group.add(boom);
    const sailMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.8, side: THREE.DoubleSide, envMap: env });
    const tri = (pts: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.computeVertexNormals();
      return new THREE.Mesh(g, sailMat);
    };
    const sails = new THREE.Group();
    sails.name = 'sails';
    sails.add(tri([0, 2.3, -0.5, 0, 15.5, -0.55, 0, 2.3, 3.8]));      // main
    sails.add(tri([0, 1.1, -5.2, 0, 13.5, -0.7, 0, 1.6, -0.9]));      // jib
    group.add(sails);
    return group;
  },
};
