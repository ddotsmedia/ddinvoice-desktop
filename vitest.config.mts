import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Root run includes packages/db, which needs a temp Postgres (globalSetup, embedded-postgres).
export default defineConfig({
  resolve: {
    alias: { '@ddinvoice/contracts': fileURLToPath(new URL('packages/contracts/src/index.ts', import.meta.url)) },
  },
  test: {
    globalSetup: ['packages/db/tests/global-setup.ts'],
    // One shared database: run files sequentially so SERIALIZABLE conflicts are not cross-test noise.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
