import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const packages = ['apps/api', 'apps/web', 'packages/shared'];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { import: importPlugin },
    settings: { 'import/resolver': { typescript: true } },
  },
  ...packages.map((directory) => ({
    files: [`${directory}/**/*.{ts,tsx,js,mjs,cjs}`],
    rules: {
      'import/no-extraneous-dependencies': [
        'error',
        { packageDir: path.join(root, directory), devDependencies: true },
      ],
    },
  })),
  {
    files: ['packages/shared/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
