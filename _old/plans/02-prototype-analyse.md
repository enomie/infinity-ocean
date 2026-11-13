# Prototype-Analyse

**Quelle:** `prototype/infinite_webgpu_ocean (2).html` (~842 Zeilen, monolithisch)

## Was funktioniert (behalten als Verhalten, nicht als Implementierung)

| Feature | Beschreibung |
|---------|----------------|
| Gerstner-Swell | 4 Komponenten, Phasen aus \( \omega = \sqrt{gk} \), Steepness |
| Interaktion | Klick → ringförmige Solitär-Ringe (Ring-Buffer, max 12) |
| Bootswake | Ring-Buffer (max 20), sternbasiert, koppelt an Geschwindigkeit |
| Infinite Ocean | Meshes folgen Kamera (`snap` auf 2m-Gitter), Ring bis ~2400m |
| Boot | Stylisiertes Segel-/Motorschiff, Bleikiel + Bulb, Cabin, Mast |
| Steuerung | WASD Schub + Ruder, Orbit-Kamera mit Soft-Follow |
| Physik (custom) | 4-Punkt-Buoyancy, Kiel-Righting-Torque, Wasserreibung |
| Atmosphäre | Fog, Sonne, einfache Sky-Kugel, halb-auflösende Planar Reflection |

## Kritische FPS-Probleme (warum Neubau)

### 1. CPU-Vertex-Animation pro Frame (Hauptkiller)

- Inneres Grid: `180 × 180` Segmente → **~32.761 Vertices**
- Pro Vertex: volle `getWaterDisplacement()` (Gerstner + bis zu 12 Klicks + 20 Wakes)
- Danach: `computeVertexNormals()` auf dem gesamten Grid
- Äußerer Ring: zusätzliche Vertices mit gleicher Logik (reduziert auf 2 Gerstner, aber trotzdem O(n))

**Effekt:** CPU skaliert linear mit Auflösung; GPU-TSL existiert im Import Map, wird **nicht genutzt** (`MeshStandardMaterial` + `position.needsUpdate`).

### 2. Doppelter Render-Pass (Reflection)

- Jeder Frame: volle Szene in Half-Res RT spiegeln (Wasser ausblenden, invertierte Kamera)
- Zusätzlicher Overdraw + Synchronisation; sinnvoll nur mit klarem Qualitäts-/Kosten-Tradeoff

### 3. Physik-Hot-Path (Allokationen & Doppelarbeit)

- `updateBoatPhysics`: viele `.clone()` pro Frame (`forwardDir`, Kräfte, Probes)
- Wellenhöhe für Boot: identische analytische Summe wie fürs Mesh — **keine gemeinsame, optimierte Sampler-Schicht**
- Kein fester Physik-Timestep → bei Frame-Drops instabile Integration

### 4. Kein Rapier / kein SIMD

- Custom Euler/Quaternion-Integration, willkürliche Trägheits-/Dämpfungskonstanten
- Keine saubere Kollisionshülle, kein deterministischer Fixed-Step

### 5. Himmel ohne Wolken-Pipeline

- `MeshBasicMaterial`-Kugel — kein `Sky`-Shader (Preetham), keine volumetrischen/billboard Wolken
- Sonne und Hintergrund nicht an echte Himmelsmodelle gekoppelt

### 6. Stack im Prototyp veraltet / hybride

- Three **0.174.0** per CDN (aktuell npm: **0.187.0**)
- Tailwind CDN, kein Bundler, kein TypeScript, keine Lint/Build-Pipeline
- WebGL-Fallback — widerspricht „WebGPU-only, maximale FPS“ (zwei Codepfade vermeiden)

### 7. Simplex Noise

- Nirgends verwendet; Gerstner ist deterministisch-parametrisch (gut), aber **Foam/Wolken/Wind-Grain** brauchen separates Noise-Modul

## Feature-Lücke vs. Ziel

| Ziel | Prototyp |
|------|----------|
| TSL/WebGPU Ocean | CPU-Mesh |
| Rapier SIMD | Custom JS |
| simplex-noise npm | — |
| Wolken ala Three | Flache Kugel |
| Modulare Dateien | Eine HTML-Datei |

## Was beim Portieren 1:1 nachgebaut werden soll (Gameplay)

1. Kamera-snapped Ozean um Spieler/Boot
2. Klickwellen + Boot-Wake in Heightfield (GPU + identischer CPU-Sampler)
3. WASD + Ruder + Knoten-Anzeige
4. Bleikiel-Visuell + stabilisierendes Drehmoment (physikalisch über niedrigen Schwerpunkt / Buoyancy-Probes)
5. Orbit-Kamera, HUD, Status-Badge WebGPU

## Was bewusst nicht portiert wird (ohne Review)

- WebGL-Fallback
- CPU-basierte Ocean-Deformation als Primärpfad
- Ungebremste `clone()` in der Physik-Schleife
- Reflection-Pass als Default (→ optional / Quality-Tier, siehe Master-Plan)
