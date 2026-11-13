import * as THREE from 'three';
import type { VesselSpec } from './types';
import { box, mat } from './hull';

const LEN = 72, R = 4.6;

/** 0 — nuclear attack submarine: dives with ↓, surfaces with ↑, pitches into the dive */
export const submarine: VesselSpec = {
  name: 'Atom-U-Boot', len: LEN, beam: R * 2,
  maxSpeed: 14, reverse: 0.3, accel: 0.06, turnRate: 0.11, turnMinSpeed: 3,
  heave: 6, damping: 3.5, rollStiff: 6, rollDamp: 2.5, turnHeel: 0.006, squat: 0,
  submarine: true,
  screws: { x: [0], y: -R * 0.8, z: LEN / 2 - 1.5, r: 1.15, blades: 7 },
  camDist: 55, camHeight: 4,
  build(env) {
    const group = new THREE.Group();
    const hullMat = mat(env, 0x16181b, 0.55, 0.15);
    const dark = mat(env, 0x0c0d0f, 0.7);
    const yOff = -R * 0.8; // hull axis below the waterline when surfaced

    // pressure hull: lathe profile (blunt bow, long parallel body, tapered stern)
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 40; i++) {
      const s = i / 40; // 0 bow … 1 stern
      let r: number;
      if (s < 0.12) r = R * Math.sqrt(1 - Math.pow(1 - s / 0.12, 2));
      else if (s < 0.7) r = R;
      else r = R * (1 - Math.pow((s - 0.7) / 0.3, 1.6) * 0.92);
      prof.push(new THREE.Vector2(Math.max(r, 0.05), -LEN / 2 + s * LEN));
    }
    const lathe = new THREE.LatheGeometry(prof, 40);
    lathe.rotateX(Math.PI / 2); // lathe axis y → z, bow at -z
    const hull = new THREE.Mesh(lathe, hullMat);
    hull.position.y = yOff;
    group.add(hull);
    // sail (conning tower) with fairwater planes and masts
    const sail = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 7, 6, 16), hullMat);
    sail.rotation.x = Math.PI / 2;
    sail.scale.set(1, 1, 4.2);
    sail.position.set(0, yOff + R + 2.6, -LEN * 0.22);
    group.add(sail);
    group.add(box(hullMat, 11, 0.35, 2.2, 0, yOff + R + 3.4, -LEN * 0.22 - 1));
    for (const [x, h] of [[0, 3.5], [0.5, 2.6], [-0.5, 2.2]] as const) {
      group.add(box(dark, 0.3, h, 0.3, x, yOff + R + 5.6, -LEN * 0.22 + 1.5));
    }

    // cruciform stern control surfaces + propulsor
    const fin = (w: number, h: number, rotZ: number) => {
      const f = box(hullMat, w, h, 4.5, 0, 0, 0);
      f.geometry.translate(0, -h / 2, 0);
      f.position.set(0, yOff, LEN / 2 - 7);
      f.rotation.z = rotZ;
      return f;
    };
    group.add(fin(0.35, 6.5, 0), fin(0.35, 6.5, Math.PI), fin(0.35, 6.5, Math.PI / 2), fin(0.35, 6.5, -Math.PI / 2));
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.1, 2.2, 24, 1, true), dark);
    duct.material.side = THREE.DoubleSide;
    duct.rotation.x = Math.PI / 2;
    duct.position.set(0, yOff, LEN / 2 - 1.5);
    group.add(duct);
    // flat deck walkway on top
    group.add(box(dark, 2.2, 0.1, LEN * 0.55, 0, yOff + R - 0.05, -LEN * 0.08));
    return group;
  },
};
