import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_DEV_API ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    proxy: {
      // Single-origin dev experience: browser talks only to the Vite server,
      // which forwards /api to the Node backend (SSE included).
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
