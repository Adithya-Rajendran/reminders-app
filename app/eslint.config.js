import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

const sharedGlobals = {
  fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  Buffer: 'readonly', console: 'readonly', process: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
}

export default [
  { ignores: ['public/**', 'node_modules/**', 'dist/**'] },
  js.configs.recommended,
  {
    files: ['client/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...sharedGlobals },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-react': 'off',
      'react/jsx-uses-vars': 'error', // components referenced only in JSX count as used
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unknown-property': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    // Widget boundary: a widget may import only `react`, its own sibling files
    // (./…), and the widget SDK (../widget-sdk). All app data arrives through the
    // ctx capabilities the host/SDK provide — never via direct store/api/bus imports.
    files: ['client/src/widgets/**/*.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../*', '../../*', '../../../*', '!../widget-sdk', '!../widget-sdk/**'],
          message: 'Widgets may import only react, sibling files (./), and the widget SDK (../widget-sdk). Reach app data through ctx capabilities, not direct imports.',
        }],
      }],
    },
  },
  {
    // Component-test harness (vitest + jsdom + Testing Library): JSX test files
    // and the jsdom setup shim. Browser + node globals; vitest primitives are
    // imported explicitly (no magic globals).
    files: ['test/**/*.jsx', 'client/src/**/*.test.jsx', 'test/setup.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...sharedGlobals },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-react': 'off',
      'react/jsx-uses-vars': 'error',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unknown-property': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['server/**/*.js', 'test/**/*.{js,mjs}', '*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...sharedGlobals },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
]
