import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';

export default defineConfig([
  globalIgnores(['node_modules/*', 'admin/node_modules/*', 'admin/dist/*', 'admin/vite.config.ts', '.vercel/*', '.local/*']),
  js.configs.recommended,
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, think: 'readonly' } }
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['test/e2e/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    files: ['admin/src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
    languageOptions: { globals: globals.browser, parserOptions: { ecmaFeatures: { jsx: true } } }
  },
  {
    rules: {
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
      'no-unused-vars': ['error', { ignoreRestSiblings: true }]
    }
  }
]);
