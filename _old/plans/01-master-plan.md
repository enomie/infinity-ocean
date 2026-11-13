# Master-Plan: Infinity Ocean (Neubau)

## 1. Zielbild

Ein **WebGPU-only** Segel-/Motorboot-Demo auf **unendlichem Ozean**:

- **Three.js** (aktuellste stabile Version, WebGPU + TSL)
- **Rapier 3D SIMD** für Rigid-Body-Dynamik
- **simplex-noise** (npm) für Wolken, Foam-Grain, optional Wind-Variation
- Modulare **TypeScript/Vite**-Codebasis mit klarer Trennung Render / Ocean / Physics / Input
- **Maximale FPS**: GPU-verteilter Ozean, minimaler CPU pro Frame, fester Physik-Step

Referenzverhalten: bestehender HTML-Prototyp (Steuerung, Wake, Klickwellen, Bleikiel-Boot), aber **nicht** die CPU-Ocean-Implementierung.

---

## 2. Technologie-Stack (Versionen festnageln)

| Paket | Version (Stand Planung) | Zweck |
|-------|-------------------------|--------|
| `three` | **^0.187.0** | `WebGPURenderer`, TSL, Addons (`Sky`, Controls) |
| `@dimforge/rapier3d-simd-compat` | **^0.21.0** | Physik mit SIMD-WASM |
| `simplex-noise` | **^4.0.3** | 2D/3D/4D Simplex (Wolken, Foam) |
| `vite` | **^8.x** | Dev + Build, HMR — **Port 9191** (`strictPort`) |
| `typescript` | **~5.7+** | strict |
| Optional später: `stats-gl` oder Three `renderer.info` | — | FPS/Debug |

### Three.js Build-Aliase (Vite)

```ts
// vite.config — resolve.alias (konzeptuell)
'three' → 'three/build/three.webgpu.js'
'three/webgpu' → 'three/build/three.webgpu.js'
'three/tsl' → 'three/build/three.tsl.js'
'three/addons' → 'three/examples/jsm'  (vor dem `three`-Alias in Vite)

// server: { port: 9191, strictPort: true, host: true }
```

- **Kein** CDN-Import Map im Produktionspfad.
- Addons über `three/addons/...` (npm-Paketpfade).

### WebGPU-Gate

- Vor `renderer.init()`: `if (!navigator.gpu) → Fehlerseite`
- Optional: `renderer._getFallback = null` (kein stiller WebGL-Wechsel), falls Three-API das weiterhin unterstützt.

---

## 3. Architektur (logische Schichten)

```
┌─────────────────────────────────────────────────────────┐
│  main.ts → App → GameLoop (rAF + fixed physics accr.) │
├──────────────┬──────────────────────┬────────────────────┤
│   Input      │   Render / Scene     │   Physics (Rapier) │
│   CameraRig  │   Sky + Clouds       │   Boat body      │
│   HUD        │   Ocean (TSL)        │   Buoyancy       │
│              │   Boat (visual)      │   WaterSampler   │
└──────────────┴──────────────────────┴────────────────────┘
                      ▲
                      │ WaveConfig + Ripple/Wake Buffers
                      │ (einheitliche Parameter)
```

**Prinzip „Single Source of Truth“:**

- `src/ocean/waves/GerstnerSpectrum.ts` — Wellenliste, Normalisierung, \(k\), \(\omega\)
- `src/ocean/waves/InteractiveWaves.ts` — Klick- + Wake-Ringbuffer, GPU-UBO/Storage, CPU-Mirror für Physik
- `src/ocean/WaterSampler.ts` — **einzige** CPU-Funktion für Höhe/Normal/optional horizontal displacement (für Buoyancy-Probes)
- `src/ocean/material/OceanNodes.ts` — TSL spiegelt dieselben Formeln (Gerstner-Unroll oder kleine Anzahl uniformer Wellen + Textur für Ripples)

---

## 4. Verzeichnisstruktur (Ziel-Repo)

```
infinity-ocean/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/                    # nur statische Assets (falls nötig)
├── plans/                     # diese Dokumente
└── src/
    ├── main.ts
    ├── app/
    │   ├── App.ts                 # init-Reihenfolge, resize, teardown
    │   └── GameLoop.ts            # time, fixedStep, render
    ├── config/
    │   ├── constants.ts           # MAX_RIPPLES, GRID, etc.
    │   └── tuning.ts              # Wellen, Boot, Wolken (Designer-Werte)
    ├── render/
    │   ├── createRenderer.ts
    │   └── SceneLights.ts         # Sonne, Ambient, koppelbar an Sky
    ├── sky/
    │   ├── SkySystem.ts           # THREE.Sky (Preetham)
    │   ├── SunController.ts       # Richtung ↔ DirectionalLight
    │   └── CloudField.ts          # Wolken (siehe Abschnitt 6)
    ├── ocean/
    │   ├── OceanSystem.ts         # Facade: mesh, material, follow camera
    │   ├── geometry/
    │   │   └── OceanClipmap.ts    # radial LOD / ring segments
    │   ├── material/
    │   │   ├── OceanMaterial.ts   # NodeMaterial assemble
    │   │   └── nodes/
    │   │       ├── gerstner.ts
    │   │       ├── ripples.ts
    │   │       ├── wakes.ts
    │   │       ├── foam.ts        # simplex für grain
    │   │       └── color.ts       # Fresnel, depth tint
    │   ├── WaterSampler.ts
    │   └── InteractiveWaves.ts
    ├── boat/
    │   ├── BoatVisual.ts          # Hull, Kiel, Bulb, Mast — pure Graph
    │   ├── BoatConfig.ts          # Masse, Abmessungen, Probe-Offsets
    │   └── BoatController.ts      # Throttle, Rudder → Kräfte an Rapier
    ├── physics/
    │   ├── PhysicsWorld.ts        # World init, step, SIMD
    │   ├── BoatRigidBody.ts       # Collider-Compound (approx. Rumpf)
    │   └── BuoyancySolver.ts      # Probes → Impulse/Forces an Rapier
    ├── camera/
    │   └── OrbitFollowCamera.ts   # OrbitControls + target lerp
    ├── input/
    │   └── InputState.ts
    ├── fx/
    │   ├── SplashDecals.ts        # Klick-Ringe (GPU oder instanced quads)
    │   └── WakeSprites.ts         # Stern-Schaum (instanced, gepoolt)
    └── ui/
        └── Hud.ts
```

**Grenzen der Module:**

| Modul | Darf | Darf nicht |
|-------|------|------------|
| `OceanSystem` | Meshes, Material-Updates, Kamera-Follow | Rapier direkt importieren |
| `BuoyancySolver` | `WaterSampler`, Rapier API | Three.js Scene Graph |
| `SkySystem` | Hintergrund, Fog-Farbe vorschlagen | Ocean-Uniforms setzen |
| `App` | alles verkabeln | Wellenformeln duplizieren |

---

## 5. Infinite Ocean (GPU-first)

### 5.1 Geometrie-Strategie

**Nicht:** 180² CPU-deformiertes Plane wie im Prototyp.

**Stattdessen (empfohlen für v1):**

1. **Clipmap / radial LOD** um Kamera (ein Mesh oder 2–3 Ringe):
   - Innerer Bereich: höhere Segmentdichte (z. B. 128–256m, 64–96 Seg)
   - Äußerer Bereich: power-curve Radius bis Fog-Horizont (~1500–2500m)
   - Referenz: Industry-üblich „infinite water“ = mesh translation + vertex fade am Rand

2. **Vertex Shader (TSL):**
   - Gerstner (Start: **4 Komponenten** wie Prototyp, Upgrade-Pfad: 8–16 mit compile-time unroll)
   - Additive Ripples/Wakes aus **Uniform-Buffer** ( struktur wie Prototyp: `x, z, time, amp[, heading]`)

3. **Horizont / Fog:**
   - `scene.fog = FogExp2` — Farbe aus `SkySystem.getHorizonColor()` für nahtlosen Übergang
   - Ocean-Mesh Y-Displacement am äußeren Rand mit `vertFade` → 0 (keine sichtbaren Mesh-Kanten)

4. **Kamera-Follow:**
   - Wie Prototyp: snap X/Z (2m oder clipmap-tile size) — **nur** Transform des Ocean-Root, keine Vertex-Neuberechnung auf CPU

### 5.2 Gerstner in TSL

- Richtungen vorab normalisieren (Config)
- Im Shader: `sin/cos` Phasen, horizontale Verschiebung `qi * amp * dir * cos`, vertikal `amp * sin`
- **Normal:** analytisch aus Summe (Tangent/Binormal cross), als varying — **kein** `computeVertexNormals()` zur Laufzeit

### 5.3 Klick- & Wake-Wellen

**Phase v1 (Parität mit Prototyp):**

- Identische analytische Ringe im **Fragment/Vertex-Node** (Gaussian um expanding front)
- CPU: `InteractiveWaves` aktualisiert Buffer; GPU liest N Einträge in Schleife (kleines N: 12+20)

**Phase v2 (optional, nur wenn Shader-Loop teuer):**

- Wake in niedrig aufgelöstem **Float-Texture Ping-Pong** (Tidewater-/Fluid-ähnlich) — erst nach Profiling

### 5.4 Material / Look

- NodeMaterial: depth-based color, Fresnel spec, Sun direction von `SunController`
- **Foam (leicht):** Jacobian/Gerstner-Fold **oder** Höhengradient + `simplex-noise` für Grauschnee auf Kämmen (Vault80-Inspiration, vereinfacht)
- **Reflektion:**
  - Default: Sky env + Sonnen-Specular (günstig)
  - Optional Tier High: planar reflection alle 2 Frames, halbe Auflösung (Prototyp-Verhalten)

### 5.5 CPU `WaterSampler`

- Gleiche Reihenfolge: Gerstner → ripples → wakes
- API:

```ts
sampleHeight(x, z, t): number
sampleDisplacement(x, z, t): { x, y, z }
sampleNormal(x, z, t): Vector3  // aus analytischen Gerstnern + finite diff nur für additive Wellen
```

- Optimierung: für Buoyancy nur `y`; Wake/Klick-Loop early-out über Zeitfenster
- **Batching (Phase 2):** `sampleHeights(Float32Array xs, zs, out)` für SIMD-freundliche Schleife

---

## 6. Himmel & Wolken („ala Three“)

### 6.1 Sky

- Official Addon: **`Sky`** (`three/addons/objects/Sky.js`)
  - Preetham-Modell, `uniforms` SunPosition koppeln an `DirectionalLight`
- `SceneLights.syncFromSky(sunElevation, sunAzimuth)`
- Fog-Farbe aus unterem Himmelshemisphere-Sample (oder feste tuning-Farbe initial)

### 6.2 Wolken

**Empfehlung v1 (Performance + Three-Ökosystem):**

- **`Cloud`** Addon (`three/addons/objects/Cloud.js`) **oder** mehrere instanzierte Volumen mit Noise-modulierter Opacity
- Alternative falls Addon zu alt: **Instanced Billboards** (quads), Shader:
  - UV → `simplex-noise` fBm (2–3 Oktaven)
  - Sonnenrichtung für Rim-Light
  - Langsame Winduniform `uTime`

**Platzierung:**

- Wolkenfeld als Kind von rotierendem / scrollendem Group nahe Fog-Radius (nicht in naher Kamera, um Aliasing zu vermeiden)
- Wenige große Cluster > viele kleine Meshes

**Nicht in v1:**

- Voll volumetric raymarch inside whole scene (FPS-Risiko ohne dediziertes R&D)

### 6.3 Sonnenscheibe

- Optional kleine `Sprite` oder emissive Sphere am `SunController` Richtungsvektor, weit entfernt — wie Prototyp, aber an Sky ausgerichtet

---

## 7. Boot, Kiel & Rapier

### 7.1 Visual (`BoatVisual`)

1:1 Hierarchie wie Prototyp übernehmen (Hull, Kiel-Fin, Bleibulb, Cabin, Mast, Flag) — aber als **eine Group-Fabrik**, Materialien teilen wo möglich.

### 7.2 Rapier Rigid Body

- **Dynamic** rigid body, Init leicht über Wasser
- Collider: **Compound**
  - Box: Rumpf (ca. 2.4 × 0.9 × 4.4)
  - Box/Capsule: Kiel-Fin unterhalb
  - Optional: dichtere Bulb als Ball mit höherer Dichte (Mass Properties!)
- **`setAdditionalMassProperties`** oder Massverteilung so setzen, dass **COM tiefsitzt** (Bleikiel-Effekt ohne fake Righting-Hack)

### 7.3 Buoyancy (Rapier hat kein Wasser-Plugin)

- `BuoyancySolver` nach **jedem** Rapier-Substep:
  - 4–8 Probes in lokalem Bootsraum (Prototyp: Ecken Rumpf, etwas unter Deck)
  - `submersion = waterY - probeY`
  - Kraft `max(0, submersion * k - damping * vY)` an Weltposition via `applyImpulseAtPoint` / extended API
  - Drehmoment entsteht natürlich durch Off-Center-Probes
- Righting: primär **COM + Kielmasse**, sekundär kleines `keelRighting` aus tuning nur wenn nötig

### 7.4 Antrieb & Ruder

- Thrust entlang Boots-Forward in lokalem Raum (WASD wie Prototyp)
- Ruder: Torque um Y proportional zu Vorwärtsgeschwindigkeit (abgeleitet aus Rapier `linvel`)
- Wasserwiderstand: entgegengesetzt velocity, higher lateral (anisotropic drag) — als analytische Kräfte, nicht durch „Collider reibt gegen Luft“

### 7.5 Sync Render ↔ Physics

- `BoatVisual` Group: position/rotation aus Rapier (+ optional interpolation für Render-Frame)
- Wake-Spawning: wenn `speed > threshold` → `InteractiveWaves.pushWake(sternWorld, heading, amp)`

---

## 8. Input, Kamera, FX

| System | Implementierung |
|--------|-----------------|
| Input | `keydown/keyup` Map; pointer: nur Linke Klick für Ripple, Rechts Orbit |
| Kamera | `OrbitControls`, `maxPolarAngle` knapp über Horizont, target `lerp` Boot-Pos |
| Klick | Ray vs. **Plane y=0** oder Ocean-Hit (y≈0 reicht für v1) |
| Splash/Wake FX | Instanced Quads mit Pool (`MAX_SPLASH`, `MAX_WAKE_PARTICLES`); **kein** dispose pro Frame ohne Limit |

---

## 9. Game Loop

```
rAF:
  dt = clamp(now - prev)
  acc += dt
  while acc >= FIXED_DT:
    InteractiveWaves.prune(time)
    BuoyancySolver.prepareProbes()
    applyForces(throttle, rudder)
  PhysicsWorld.step(FIXED_DT)
  acc -= FIXED_DT

  ocean.updateUniforms(time, camera)
  sky.update(delta)
  clouds.update(delta)
  fx.update(time)
  camera.update()
  renderer.render(scene, camera)
  [optional reflection pass]
  hud.update()
```

- `FIXED_DT = 1/60`, max substeps pro Frame (z. B. 3) gegen Spiral of Death
- Render bei **120 Hz**: Pose zwischen Physics-Steps **interpolieren** (`alpha = acc / FIXED_DT`)

---

## 10. simplex-noise — konkrete Nutzung

| Bereich | Nutzung |
|---------|---------|
| `CloudField` | 2D fBm für Alpha-Maske auf Billboard |
| `foam.ts` | leichte 2D noise zur Coverage-Variation (damit Foam nicht „gestrichen“ wirkt) |
| Optional später | Wind kick randomisiert kurze Gerstner-Amplitude (sehr subtil) |

Import:

```ts
import { createNoise2D } from 'simplex-noise';
// Seed aus tuning für reproduzierbare Wolken
```

**Nicht:** pro Vertex Ocean-Gerstner durch Noise ersetzen (weder realistisch noch billiger).

---

## 11. Entwicklungsphasen (Reihenfolge, kein Parallel-Chaos)

### Phase 0 — Fundament (1–2 Tage)

- Vite + TS + Aliase + WebGPU gate
- Leere Scene, `SkySystem`, Orbit-Kamera, HUD-Skeleton
- Rapier World ohne Boot (sanity step)

**Akzeptanz:** Fenster läuft, 120 FPS leere Scene, WebGPU-Badge grün

### Phase 1 — Ocean GPU (Kern)

- `GerstnerSpectrum` + `OceanClipmap` + TSL Material (ohne Ripples)
- Kamera-Follow + Fog

**Akzeptanz:** Ozean bewegt sich, keine CPU-Vertex-Updates, **120 FPS** (Budget)

### Phase 2 — Interaktive Wellen

- `InteractiveWaves` + Shader-Loops + Klick
- `WaterSampler` Parität (manuell gegentesten Bootshöhe später)

### Phase 3 — Boot Rapier

- Compound collider, Buoyancy, WASD
- Visual sync, Kiel-COM

**Akzeptanz:** Boot schwimmt stabil, kentert nicht ohne extreme Wellen

### Phase 4 — Wake & FX

- Wake buffer + Stern-Partikel
- Optional Foam-Noise

### Phase 5 — Polish

- CloudField
- Reflection Tier
- Performance-Overlay, tuning pass

### Phase 6 — Hardening

- ESLint + Build CI
- Dokumentation README (kurz, nicht plans duplizieren)

---

## 12. Prototyp-Migration

| Artefakt | Aktion |
|----------|--------|
| `prototype/infinite_webgpu_ocean (2).html` | **Behalten** als Referenz, nicht löschen |
| Wellen-Tuning | aus `waveParams` nach `config/tuning.ts` kopieren |
| Boot-Maße / Probes | nach `BoatConfig.ts` |
| HUD-Texte | optional `ui/Hud.ts` |

Kein automatisches Portieren der 800 Zeilen — selektives Übernehmen von **Zahlen**, nicht von **Struktur**.

---

## 13. Risiken & Mitigation

| Risiko | Mitigation |
|--------|------------|
| TSL Ripple-Loop zu groß für Shader | N reduzieren; Waakes in Textur Phase 2 |
| Rapier WASM Ladezeit | Preload in `index.html` / async init mit Ladebalken |
| Three 0.187 API drift | Version pinnen in `package.json`, nicht ^ für three |
| Buoyancy instabil | Fixed step, Impulse limits, mehr Damping in tuning |
| WebGPU Safari | Out of scope v1; klare Browserliste |

---

## 14. Offen zur Freigabe (vor Code-Start klären)

Siehe [`04-decisions.md`](./04-decisions.md) für Festlegungen.

1. **Qualität Reflektion:** env-only vs. planar default?
2. **Gerstner-Count v1:** 4 (Prototyp) vs. 8 (besserer Look, mehr Shader-ALU)?
3. **Wolken:** `Cloud.js` Addon vs. eigene Instanced Shader?
4. **TypeScript strictness:** `noUncheckedIndexedAccess` ja/nein?

**Festgelegt:** Vite **9191**, **120 FPS Pflicht**.

---

## 15. Erfolgskriterien (Definition of Done)

- [ ] `npm run build` ohne Fehler
- [ ] ESLint clean
- [ ] Kein `position.needsUpdate` auf Ocean-Hauptmesh
- [ ] Rapier SIMD Paket aktiv (`init` logs / bundle name check)
- [ ] `simplex-noise` importiert in Cloud + (optional) Foam
- [ ] Sky + Sonne + Wolken sichtbar, Fog matched
- [ ] Boot mit sichtbarem Kiel, WASD, Wake, Klickwellen
- [ ] **120 FPS** @ 1080p auf Referenz-GPU (Budget aus `03-performance-budget.md`)

---

*Nächster Schritt nach Freigabe: Phase 0 scaffolden — erst dann Code.*
