import { defineConfig } from 'vitest/config';

// Renderer component tests opt into jsdom per file (// @vitest-environment jsdom).
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: false,
    testTimeout: 15_000,
  },
});
