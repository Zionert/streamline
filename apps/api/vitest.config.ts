import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      // Consume @streamline/shared directly from its TypeScript sources.
      conditions: ['@streamline/source', ...defaultServerConditions],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
