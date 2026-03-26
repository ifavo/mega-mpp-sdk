import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/*/src/__tests__/integration.test.ts',
      'packages/*/src/__tests__/*.integration.test.ts',
      'packages/*/src/__tests__/live.test.ts',
    ],
    projects: [
      {
        test: {
          name: 'integration',
          include: [
            'packages/*/src/__tests__/integration.test.ts',
            'packages/*/src/__tests__/*.integration.test.ts',
          ],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'live',
          include: ['packages/*/src/__tests__/live.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
