import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_');
  const apiProxyTarget = env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
      // Consume @streamline/shared directly from its TypeScript sources.
      conditions: ['@streamline/source', ...defaultClientConditions],
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/api/, ''),
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
