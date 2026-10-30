import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Read .env from the repo root, where every other setting lives. Only VITE_* names reach the
  // browser, so server secrets in the same file are never bundled.
  envDir: '../..',
  server: {
    port: 5173,
    // During local development the panel calls the API through Vite.
    proxy: { '/api': 'http://localhost:3000', '/healthz': 'http://localhost:3000' },
  },
  test: {
    // Component tests render into jsdom, a browser-like DOM inside Node.
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
