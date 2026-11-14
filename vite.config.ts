import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so dist works in a PHP subdirectory (not only at domain root).
  base: './',
  server: { port: 9191, strictPort: true, host: true },
});
