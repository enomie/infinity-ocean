/** Phase 0 placeholder — App wiring folgt laut plans/01-master-plan.md */
console.info('[infinity-ocean] Vite :9191 — 120 FPS Pflicht (plans/04-decisions.md)');

if (!('gpu' in navigator)) {
  document.body.innerHTML =
    '<p style="color:#f8fafc;font-family:system-ui;padding:2rem">WebGPU erforderlich.</p>';
}
