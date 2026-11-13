import * as THREE from 'three';

export interface HullParams {
  len: number;
  beam: number;
  draft: number;
  free: number; // freeboard amidships
  bowRise?: number; // extra sheer at bow
  bowLen?: number; // fraction of length that tapers (0..1)
  sternW?: number; // transom width factor
  bottom?: number; // antifouling colour
  stripe?: number;
  top?: number;
  deck?: number;
  boot?: number; // height of antifouling above waterline
}

/** Simple parametric hull: round-bilge sections, tapered bow, flat transom, deck. */
export function buildHull(p: HullParams, env: THREE.Texture) {
  const { len, beam, draft, free } = p;
  const bowRise = p.bowRise ?? free * 0.4;
  const bowLen = p.bowLen ?? 0.45;
  const sternW = p.sternW ?? 0.88;
  const boot = p.boot ?? Math.max(0.12, draft * 0.12);
  const halfW = (s: number) =>
    (beam / 2) * (s < bowLen ? 1 - Math.pow(1 - s / bowLen, 2) : 1 - (1 - sternW) * Math.pow((s - bowLen) / (1 - bowLen), 2));
  const dr = (s: number) => draft * THREE.MathUtils.smoothstep(s, 0, bowLen * 0.7) + draft * 0.05;
  const sheer = (s: number) => free + bowRise * Math.pow(1 - s, 2.2);

  const NS = 48, NT = 16;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const cBottom = new THREE.Color(p.bottom ?? 0x731010), cStripe = new THREE.Color(p.stripe ?? 0x0b1530), cTop = new THREE.Color(p.top ?? 0xb8bab8);
  const ring = (s: number) => {
    const w = halfW(s), d = dr(s), f = sheer(s);
    const pts: [number, number][] = [];
    for (let t = 0; t <= NT; t++) {
      const u = t / NT;
      if (u < 0.6) {
        const th = (u / 0.6) * Math.PI * 0.5;
        pts.push([w * Math.pow(Math.sin(th), 0.6) * 0.97, -d * Math.cos(th)]);
      } else {
        const v = (u - 0.6) / 0.4;
        pts.push([w * (0.97 + 0.05 * v), v * f]);
      }
    }
    return pts;
  };
  for (const side of [1, -1])
    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      for (const [x, y] of ring(s)) {
        pos.push(side * x, y, -len / 2 + s * len);
        const c = y < boot ? cBottom : y < boot + Math.max(0.15, free * 0.12) ? cStripe : cTop;
        col.push(c.r, c.g, c.b);
      }
    }
  const rowLen = NT + 1, sideLen = (NS + 1) * rowLen;
  for (let k = 0; k < 2; k++)
    for (let i = 0; i < NS; i++)
      for (let t = 0; t < NT; t++) {
        const a = k * sideLen + i * rowLen + t, b = a + rowLen;
        if (k === 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
  const base = pos.length / 3;
  const st = ring(1);
  for (const sx of [1, -1]) for (const [x, y] of st) { pos.push(sx * x, y, len / 2); col.push(cTop.r, cTop.g, cTop.b); }
  for (let t = 0; t < NT; t++) {
    const a = base + t, b = base + rowLen + t;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  // deck
  const dp: number[] = [], di: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const s = i / 40, w = halfW(s), y = sheer(s) - 0.02, z = -len / 2 + s * len;
    dp.push(-w, y, z, w, y, z);
  }
  for (let i = 0; i < 40; i++) { const a = i * 2; di.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  dg.setIndex(di);
  dg.computeVertexNormals();

  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, envMap: env, side: THREE.DoubleSide })));
  group.add(new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ color: p.deck ?? 0x8a6240, roughness: 0.75, envMap: env, envMapIntensity: 0.6 })));
  return { group, halfW, sheer };
}

/** tiny helpers for superstructure */
export function mat(env: THREE.Texture, color: number, roughness = 0.5, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: env });
}
export function box(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}
export function cyl(m: THREE.Material, r: number, h: number, x: number, y: number, z: number, r2 = r) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, h, 16), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}
