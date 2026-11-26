import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/out/**', '**/release/**', '**/node_modules/**', 'vendor/**'] },
  ...tseslint.configs.recommended,
);
