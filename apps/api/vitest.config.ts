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
    // Prepares the dedicated test database (see src/test/test-database.ts).
    globalSetup: ['./src/test/global-setup.ts'],
    // Integration tests share one database, so test files must not run concurrently.
    fileParallelism: false,
  },
});
