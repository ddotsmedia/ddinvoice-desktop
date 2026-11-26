import { configDefaults, defineConfig } from 'vitest/config';

// packages/db needs a temp Postgres (globalSetup); it runs via its own package script.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, 'packages/db/**'] } });
