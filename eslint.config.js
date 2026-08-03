import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * Flat config for ESLint 9.
 *
 * The project had `npm run lint` in its scripts from the start but neither a
 * config nor ESLint itself installed, so the command had never once run. That
 * also means the codebase has never been linted — this config is deliberately
 * set at what the existing code already satisfies plus the rules that catch
 * real mistakes, rather than at a standard that would bury a first run under
 * hundreds of stylistic complaints nobody will read.
 *
 * Three separate scopes, because this repository holds three kinds of
 * JavaScript: typed React in `src/`, plain Node modules in `server/`, and
 * standalone collectors in `scripts/`.
 */
export default tseslint.config(
  {
    // Build output, dependencies and the committed data archives.
    ignores: ['dist/**', 'release/**', 'node_modules/**', 'data/**'],
  },

  /* ------------------------------------------------------------------ */
  /* Frontend: typed React                                              */
  /* ------------------------------------------------------------------ */
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Vite's fast refresh only works when a module exports components alone.
      // A warning rather than an error: several modules deliberately export a
      // component next to its constants, and splitting them would be churn.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // An unused argument named with a leading underscore is a documented
      // signature, not an oversight — the Express error handler needs its
      // fourth parameter to be recognised as one.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  /* ------------------------------------------------------------------ */
  /* Server, collectors and shell: plain Node                           */
  /* ------------------------------------------------------------------ */
  {
    files: [
      'server/**/*.js',
      'scripts/**/*.js',
      'test/**/*.js',
      'electron/**/*.js',
      'vite.config.ts',
    ],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // `catch {}` with no binding is used throughout for "the value is simply
      // absent"; an empty block with a comment in it is the intent, not a gap.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
