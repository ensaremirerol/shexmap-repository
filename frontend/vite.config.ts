import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In dev (outside Docker), proxy API and SPARQL calls to local services
      '/api': 'http://localhost:3000',
      '/sparql': 'http://localhost:7001',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
