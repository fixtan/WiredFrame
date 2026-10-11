import { defineConfig } from 'vite';

export default defineConfig({
  // Tauriは相対パスを要求することが多いためベースを相対にする
  base: './',
  server: {
    port: 1420,
    strictPort: true,
  },
});
