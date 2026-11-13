# Performance-Budget & Code-Qualitätsregeln

Zielplattform zuerst: **Desktop Chrome/Edge mit WebGPU**, `powerPreference: 'high-performance'`, Pixel-Ratio gecappt.

## Frame-Ziele (1080p, Mittelklasse-GPU)

| Metrik | Ziel | Abbruch (Profiling) |
|--------|------|---------------------|
| Gesamt-Frame | **≤ 8,33 ms (120 FPS Pflicht)** | > 10 ms Mittel über 5 s @ 1080p Referenz-GPU |
| CPU (main thread) | ≤ 4 ms | Ocean- oder Physics-Loop > 2 ms allein |
| GPU | ≤ 12 ms | Reflection + Post ohne Tier abschalten |
| Draw Calls | < 80 | Jede neue Mesh-Klasse begründen |
| Ocean Vertices (sichtbar) | LOD-budget, siehe Master-Plan | Kein volles 180² CPU-Update |

## Harte Regeln („kein Scheißcode“)

### Rendering

1. **Ocean-Displacement ausschließlich im Vertex-Shader (TSL)** — keine `position.needsUpdate`-Schleife auf dem Hauptgitter.
2. **Eine Wahrheit für Wellenparameter:** Shared Config → GPU Uniforms/Nodes + CPU `WaterSampler` (gleiche Formeln, gleiche Indizes).
3. **Frustum Culling** für Wolken/Props; Ocean-Mesh: `frustumCulled = false` nur wenn technisch nötig (clipmap), dann dokumentieren.
4. **Kein WebGL-Fallback** in Produktion — early exit mit klarer UI-Meldung wenn `navigator.gpu` fehlt.
5. Reflektion: default **SSR-ähnlich TSL oder env-only**; Planar Reflection nur als **Quality: High** (halbe Auflösung, Rate-Limit 30 Hz oder jedes 2. Frame).

### Physik

1. **Rapier Fixed Timestep** (z. B. 1/60 s) mit Akkumulator; Rendering interpoliert.
2. **`@dimforge/rapier3d-simd-compat`** — ein Paket, keine Mischung mit non-SIMD.
3. Buoyancy: begrenzte Probe-Anzahl (4–8), **keine Vector3-Allokation** im Step (pooled objects).
4. Kiel: niedriger COM via **Collider-Masseverteilung** + optional explizites Righting-Moment (konfigurierbar, nicht Magic Numbers im Loop).

### CPU / GC

1. Kein `new THREE.Vector3()` in `update()` / Rapier-Step (Object Pool oder module-level scratch).
2. Ring-Buffer für Ripples/Wakes: strukturierte `Float32Array`, nicht Array von Objekten (optional Phase 2).
3. `simplex-noise`: Instanz einmalig; keine pro-Frame Noise-Objekterzeugung.

### Build & Wartung

1. **TypeScript strict**, Vite, ESLint — „fix“ = lint + build grün.
2. Öffentliche APIs pro Modul klein halten (`createOceanSystem()`, `stepPhysics(dt)`).
3. Konstanten in `config/tuning.ts` — keine Literale im Shader ohne Spiegel in Config.

## Profiler-Checkliste (vor jedem Merge)

- [ ] Performance-Overlay: CPU ocean sampler time
- [ ] Performance-Overlay: Rapier step time
- [ ] GPU timestamp (wenn verfügbar) oder Render-Statistik Three
- [ ] Vertex count ocean nach LOD-Stufe
- [ ] GC-Spikes (Chrome Performance → kein Sawtooth durch Allokationen)

## Explizite Anti-Patterns (verboten)

- Duplizierte Gerstner-Formel in Shader und Physik mit abweichenden Konstanten
- Wake/Klick-Loops mit `Math.exp` pro Vertex auf CPU für das gesamte Mesh
- Dynamisches `geometry.dispose()` für Partikel ohne Pool-Obergrenze
- Import von `three` Standardbuild statt WebGPU-Build
- Rapier World pro Frame neu erstellen
