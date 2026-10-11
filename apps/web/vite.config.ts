import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // During local development the panel calls the API through Vite.
    proxy: { '/api': 'http://localhost:3000', '/healthz': 'http://localhost:3000' },
  },
});
