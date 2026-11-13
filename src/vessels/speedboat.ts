import type { VesselSpec } from './types';
import { box, buildHull, mat } from './hull';

const LEN = 13, BEAM = 2.7;

/**
 * Flame livery as pure shader math: flat colour bands (no gradients), crisp AA edges.
 * Flames point at the bow and fan out toward the stern with a wavy outline.
 */
const HULL_FLAMES = /* glsl */ `
  if (y > -0.05) {
    c = vec3(0.05, 0.16, 0.54);                       // deep blue topside
    float mid = 0.5;
    float fan = pow(smoothstep(0.04, 1.0, s), 0.7);              // 0 at bow tip → 1 at stern
    float wav = sin(s * 30.0) * 0.025 * fan;
    float half1 = fan * 0.2 + wav;                    // outer flame
    float half2 = fan * 0.12 - wav * 0.6;               // middle flame
    float half3 = fan * 0.05 + wav * 0.4;              // core
    float d = abs(y - mid);
    c = mix(c, vec3(1.0), 1.0 - aa(half1 + 0.025, d));        // white outline
    c = mix(c, vec3(1.0, 0.25, 0.0), 1.0 - aa(half1, d));     // red-orange
    c = mix(c, vec3(1.0, 0.55, 0.0), 1.0 - aa(half2, d));     // orange
    c = mix(c, vec3(1.0, 0.85, 0.1), 1.0 - aa(half3, d));     // yellow
  }
  // white running bottom with a sharp sky-blue boot stripe
  c = mix(vec3(0.9, 0.92, 0.94), c, aa(0.02, y));
  c = mix(c, vec3(0.16, 0.66, 1.0), aa(-0.06, y) * (1.0 - aa(0.02, y)));
`;

const DECK_ARROW = /* glsl */ `
  c = vec3(0.05, 0.16, 0.54);
  float r = s;                                      // 0 bow → 1 stern
  float w1 = 0.7 * sqrt(clamp(r / 0.88, 0.0, 1.0)) * (1.0 - aa(0.88, r));
  float w2 = 0.38 * sqrt(clamp(r / 0.75, 0.0, 1.0)) * (1.0 - aa(0.75, r));
  float d = abs(a);
  c = mix(c, vec3(1.0), 1.0 - aa(w1 + 0.04, d));
  c = mix(c, vec3(1.0, 0.35, 0.0), 1.0 - aa(w1, d));
  c = mix(c, vec3(1.0, 0.75, 0.1), 1.0 - aa(w2, d));
  c = mix(c, vec3(0.06, 0.06, 0.16), 1.0 - aa(0.025, d));   // centre line
`;

/** 2 — offshore powerboat: long deep-V hull, flame paint, planes at speed */
export const speedboat: VesselSpec = {
  name: 'Offshore-Speedboot', len: LEN, beam: BEAM,
  maxSpeed: 32, reverse: 0.15, accel: 0.5, turnRate: 0.75, turnMinSpeed: 6,
  heave: 38, damping: 7, rollStiff: 36, rollDamp: 5, turnHeel: 0.008, squat: 0.004,
  planing: true,
  screws: { x: [-0.45, 0.45], y: -0.5, z: LEN / 2 + 0.4, r: 0.22, blades: 5 },
  camDist: 22, camHeight: 1.2,
  build(env) {
    const { group } = buildHull({
      len: LEN, beam: BEAM, draft: 0.6, free: 0.85, bowRise: 0.15, bowLen: 0.62, sternW: 0.98,
      vee: true, crown: 0.28, gloss: true, hullPaint: HULL_FLAMES, deckPaint: DECK_ARROW,
    }, env);
    const orange = mat(env, 0xff6a10, 0.25), white = mat(env, 0xf2f2f2, 0.45), black = mat(env, 0x0c0c10, 0.2, 0.3);
    const blue = mat(env, 0x1440b0, 0.2);
    const deckY = 1.04; // on top of the cambered deck
    // cockpit tub at the stern third
    group.add(box(black, 2.0, 0.05, 2.6, 0, deckY - 0.02, 2.2));
    for (const sx of [-0.5, 0.5]) {
      group.add(box(white, 0.75, 0.35, 0.7, sx, deckY, 2.0), box(white, 0.75, 0.65, 0.18, sx, deckY, 2.4));
    }
    group.add(box(white, 1.8, 0.35, 0.6, 0, deckY, 3.1));
    const screen = box(black, 2.0, 0.22, 0.05, 0, deckY + 0.05, 0.85); screen.rotation.x = -1.0; group.add(screen);
    group.add(box(blue, 2.2, 0.08, 0.25, 0, deckY + 0.02, 0.85));
    // raised orange engine hatch
    const hatch = box(orange, 2.1, 0.22, 2.1, 0, deckY - 0.02, 4.9);
    group.add(hatch, box(black, 0.9, 0.08, 1.2, 0, deckY + 0.2, 4.9));
    // twin outdrives
    for (const sx of [-0.45, 0.45]) group.add(box(black, 0.18, 0.7, 0.35, sx, -0.6, LEN / 2 + 0.15));
    return group;
  },
};
