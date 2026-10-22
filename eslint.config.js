import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'e2e/**/*.ts', 'tests/**/*.ts', '*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      eqeqeq: 'error',
      'no-duplicate-imports': 'error',
      'no-useless-return': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['e2e/**/*.ts'],
    // Playwright requires an object pattern for unused fixtures arguments.
    rules: { 'no-empty-pattern': 'off' },
  },
  {
    files: ['scripts/render-mockups.mjs', 'scripts/render-overhaul.mjs', 'scripts/render-og.mjs'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['public/**/*.js'],
    ignores: ['public/theme-init.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['public/theme-init.js'],
    languageOptions: { globals: globals.browser },
  },
);
