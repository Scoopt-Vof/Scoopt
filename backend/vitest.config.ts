import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    // api.test.ts and comparison.test.ts both TRUNCATE and both assert exact
    // row counts, so they cannot share one database concurrently.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
