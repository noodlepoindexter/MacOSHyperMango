import { defineConfig } from 'vite';
import { resolve } from 'path';

// Tauri serves the frontend from this dev server in development and from
// dist/ in production. Ports are fixed because tauri.conf.json references them.
export default defineConfig({
  root: 'src',
  publicDir: resolve(__dirname, 'assets'),
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'safari15',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        play: resolve(__dirname, 'src/play.html'),
        reference: resolve(__dirname, 'src/reference.html'),
        scriptEditor: resolve(__dirname, 'src/script-editor.html'),
      },
    },
  },
});
