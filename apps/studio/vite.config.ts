import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, API calls go to a running `dbarchitect open --port 4310` instance.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:4310' } },
  build: { outDir: 'dist', sourcemap: false },
});
