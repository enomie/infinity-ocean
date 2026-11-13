# Festgelegte Entscheidungen

| Thema | Entscheidung | Datum |
|-------|--------------|-------|
| **Dev-Server** | Vite, Port **9191** (`strictPort: true`) | 2025-11-11 |
| **Ziel-FPS** | **120 FPS Pflicht** @ 1080p Referenz-GPU | 2025-11-11 |

## Noch offen

1. Reflektion: env-only vs. planar default
2. Gerstner-Count v1: 4 vs. 8
3. Wolken: `Cloud.js` Addon vs. Instanced Shader
4. TypeScript `noUncheckedIndexedAccess`

## Vite (konfiguriert)

```ts
server: {
  port: 9191,
  strictPort: true,
  host: true,
}
```

Dev: `npm run dev` → `http://localhost:9191`

## 120 FPS — technische Konsequenzen

- Frame-Budget: **≤ 8,33 ms** Gesamt (siehe `03-performance-budget.md`)
- Render: `requestAnimationFrame` ungebremst; kein künstliches `setInterval(60)`
- Physik bleibt **1/60 s Fixed Step** (Rapier); bei 120 Hz Display **Interpolation** Render ↔ Physics
- Qualität Tier **High** (Planar Reflection jedes Frame) nur wenn Profil unter 8,33 ms — sonst degradieren
