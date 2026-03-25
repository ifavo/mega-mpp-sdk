import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/src/__tests__/*.test.ts'],
    exclude: ['packages/*/src/__tests__/integration.test.ts'],
    coverage: {
      provider: 'v8',
    },
  },
});
