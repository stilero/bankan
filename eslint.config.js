import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

const testGlobals = {
  ...globals.node,
  describe: 'readonly',
  test: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  afterAll: 'readonly',
  afterEach: 'readonly',
  vi: 'readonly',
};

export default [
  {
    ignores: [
      '**/coverage/**',
      'client/dist/**',
      '.data/**',
      'node_modules/**',
      '*.tgz',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      quotes: ['error', 'single', { avoidEscape: true }],
      semi: ['error', 'always'],
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['client/src/**/*.js', 'client/src/**/*.jsx'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    files: [
      'server/**/*.js',
      'scripts/**/*.js',
      'bin/**/*.js',
      '*.js',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: [
      'server/src/**/*.test.js',
      'client/src/**/*.test.jsx',
      'client/src/test/**/*.js',
      'server/test-utils.js',
    ],
    languageOptions: {
      globals: testGlobals,
    },
  },
];
