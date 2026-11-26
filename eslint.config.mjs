import tseslint from 'typescript-eslint';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/out/**', '**/release/**', '**/node_modules/**', 'vendor/**'] },
  ...tseslint.configs.recommended,
  {
    // All user-visible renderer text goes through i18next (locales/en.json + ar.json).
    files: ['apps/desktop/src/renderer/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    plugins: { i18next },
    rules: { 'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }] },
  },
);
