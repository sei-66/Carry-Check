import js from '@eslint/js';
import { fileURLToPath } from 'node:url';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default defineConfig(
  globalIgnores([
    'dist/**',
    'coverage/**',
    'cache/**',
    '.codex/**',
    '.claude/**',
  ]),
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: fileURLToPath(new URL('..', import.meta.url)),
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/workers/**',
      'src/shared/**',
      'src/domain/**',
      'src/geometry/**',
      'src/model/**',
      'src/planner/**',
      'src/application/**',
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },
  {
    files: ['src/workers/**/*.ts'],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ['**/*.config.*', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
);
