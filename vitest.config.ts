import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/ui.ts', 'src/register-webhook.ts', 'src/discover-repos.ts'],
    },
    // Each test file gets a fresh module registry to avoid state leakage
    restoreMocks: true,
  },
});
