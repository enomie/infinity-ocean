# Infinity Ocean – Projektkarte

Three.js (WebGL2, `three@0.187`) + Vite + TypeScript. Dev-Server: `npm run dev` → http://localhost:9191 (strictPort).
Ziel: **≥ 120 fps** @ ~1080p. Alles ist modular: ein Thema = eine Datei.

## Ordnerstruktur

| Pfad | Zuständig für |
|---|---|
| `src/main.ts` | Verdrahtung: Renderer, Szene, Uniforms (`shared`), Eingabe, Kamera-Orbit, Loop (`step`), Benchmark, adaptive Auflösung, URL-Testparameter |
| `src/sky.ts` | Analytischer Himmel (GLSL `SKY_GLSL`), Wolken, Noise (`NOISE_GLSL`, `NOISE_DATA`), `SkyCube` (Cubemap, 1 Seite/Frame), `SUN_DIR` |
| `src/waves.ts` | Gerstner-Wellen (16, spektral) – GLSL `WAVES_GLSL` **und** CPU-Spiegel `waveHeight()`; Dämpfung in Flachwasser über `shoreFade` |
| `src/ocean.ts` | Ozean-Mesh (polares Gitter um Kamera) + Shader: Spiegelung, SSS, Glitzer, Schaum (Kielwasser, Jacobian-Kämme, Brandung), Flachwasser-Türkis, Unterseite (Snell-Fenster). `SHARED_GLSL` = Noise+Sky+Terrain+Waves+Wake |
| `src/wake.ts` | Kielwasser-Simulation (Wellengleichung, 1024², scrollt mit Schiff), Bug-/Heckwelle, Schaum; `setVessel()` skaliert auf Schiffsgröße |
| `src/post.ts` | Post-Pass: Unterwasser (Absorption, Nebel, God-Rays, Kaustiken), Wasserlinie/Meniskus, Tonemapping (ACES) |
| `src/boat.ts` | `Vessel`: generische Fahrphysik (Auftrieb über Wellen-Samples, Gleiten, Segeln, Tauchen, Grundberührung an Inseln) |
| `src/vessels/` | Ein File pro Schiff (`VesselSpec`: Maße, Fahrwerte, `build()`); `hull.ts` = Rumpf-Baukasten (rund/V, Deckwölbung, Textur-Lackierung); `index.ts` = Tastenreihenfolge |
| `src/world/origin.ts` | **Floating Origin** `ORIGIN` (absolut = lokal + ORIGIN), Schwelle/Raster für Verschiebung |
| `src/world/terrain.ts` | **Unendlicher** Insel-Generator: deterministische Zellen (1,6 km) + Superzellen (9 km, Rieseninseln), `islandsNear()`; Höhenfunktion identisch in TS (`terrainHeight`, lokale Koords) und GLSL (`TERRAIN_GLSL`, 16 nächste Inseln via `updateGpuIslands`), Noise inselrelativ |
| `src/world/islandMesh.ts` | `IslandGrid` (inselrelatives Höhenraster, Aufbau als Generator → zeitgescheibt), Geländemesh + Farben (Sand/Wiese/Fels) |
| `src/world/vegetation.ts` | Palmen/Laub-/Nadelbäume (instanced, Wind im Vertex-Shader), Landeplätze (`Perch`) für Vögel |
| `src/world/index.ts` | `World`: Streaming (laden ≤ 9 km grob, ≤ 1,8 km fein, Bäume ≤ 3,5 km, entladen > 11 km), Bau-Budget 2 ms/Frame, `onOriginShift()`, `nearestIsland()` |
| `src/fauna/fish.ts` | `MarineLife`: 9 Fischarten in Schwärmen (instanced, Schwimmwelle im Shader), Weiße Haie; bleiben unter `MAX_FISH_Y` und ≥ 1 m über dem Terrain (zu flach → Fisch ausgeblendet, Hai schwimmt bergab ins Tiefe) |
| `src/fauna/birds.ts` | `Gulls`: Möwen mit Zustandsautomat fly → land → sit → takeoff (Strand oder Wasser) |

## Konventionen

- **Vorwärts = −Z** für Schiffe, Fische, Vögel. `heading` dreht um Y; Euler-Order `'YXZ'`.
- **Koordinaten**: Szene/Physik arbeiten in LOKALEN Koordinaten. Alles mit Position braucht `shift(dx, dz)`, das `maybeShiftOrigin()` in `main.ts` aufruft. Wellenphasen (`updateWavePhases`) und Insel-Noise sind origin-unabhängig.
- **GPU/CPU-Spiegel**: Alles, was Physik braucht (Wellenhöhe, Terrain), existiert zweimal und muss synchron bleiben (`waves.ts`, `world/terrain.ts`).
- Neue Shader, die Oberfläche/Terrain kennen müssen: `SHARED_GLSL` einbinden und `shared`-Uniforms aus `main.ts` übergeben.
- Instanced Meshes für alles Zahlreiche; Animation (Flossen, Flügel, Wind) im Vertex-Shader via `onBeforeCompile`.
- Lineares HDR-Rendering in Render-Target; Tonemapping + Gamma erst in `post.ts`.

## Neues Schiff hinzufügen
1. `src/vessels/<name>.ts` mit `export const <name>: VesselSpec = {...}` (Rumpf über `buildHull`, Aufbauten via `box`/`cyl`).
2. In `src/vessels/index.ts` in `VESSELS` eintragen (Index = Taste 1…9, 0 = zehntes).

## Inseln anpassen
Verteilung/Größen in `cellIslands()` / `superIslands()` (`world/terrain.ts`); handplatzierte Start-Inseln dort ebenfalls. Streaming-Distanzen und Auflösungen oben in `world/index.ts`.

## Steuerung
`1–9, 0` Schiff · `W/S` Gas · `A/D`/`←→` Ruder · U-Boot: `↓` tauchen `↑` auftauchen · Maus ziehen = Kamera, Rad = Zoom.

## Test-/Debug-Parameter (URL)
`v` (Schiff 1–9/0) · `auto=1` (Gas) · `dive=1` · `warp=N` (N s vorsimulieren) · `x`,`z`,`h` (Startposition absolut in m / Kurs, z. B. `x=2000000`) ·
`yaw`,`pitch`,`dist`,`ty` (Kamera) · `q` (feste Pixel-Ratio, deaktiviert adaptive Auflösung).
Konsole: `__bench(n)` → ms/Frame inkl. GPU-Sync; `await __gpu(n)` → GPU-Zeit per Timer-Query + CPU-Zeit von `step`; `__dbg.world.stats`; `__dbg` (boat, camera, shared, life, gulls, world, waveHeight).

## Performance-Stand
Hinweis: Messungen im versteckten Browser-Pane sind gedrosselt/ungenau – für echte Zahlen Pane sichtbar oder normaler Browser (FPS-Anzeige unten links).
~5 ms/Frame @ 1536×1152, 4×MSAA (Benchmark). Teuerste Teile: Ozean-Vertex (16 Wellen + Terrain), Kielwasser 1024², Fische (CPU-Matrizen).
Archiv alter Prototyp: `_old/`.
