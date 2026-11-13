import type * as THREE from 'three';

export interface VesselSpec {
  name: string;
  len: number; // m, waterline length (used for buoyancy + wake footprint)
  beam: number;
  maxSpeed: number; // m/s
  reverse: number; // fraction of maxSpeed astern
  accel: number; // 1/s response of speed to throttle
  turnRate: number; // rad/s at full rudder & speed
  turnMinSpeed: number; // m/s at which full turn rate is reached
  heave: number; // spring stiffness for vertical motion
  damping: number;
  rollStiff: number;
  rollDamp: number;
  turnHeel: number; // roll per (rudder*speed); negative = leans into turn
  squat: number; // bow-up pitch per m/s
  planing?: boolean; // rides higher on the water at speed
  sail?: boolean; // speed depends on wind angle
  submarine?: boolean; // ↑/↓ surface / dive
  /** propellers (1–3): x offsets, shaft height y, axial position z (+ = aft), blade radius r */
  screws: { x: number[]; y: number; z: number; r: number; blades?: number };
  camDist: number;
  camHeight: number;
  build(env: THREE.Texture): THREE.Group;
}
