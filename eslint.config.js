import path from 'node:path';

const filenameCaseRule = {
  meta: {
    type: 'layout',
    docs: {
      description: 'Enforce camelCase or PascalCase .mjs filenames',
    },
    schema: [],
  },
  create(context) {
    const basename = path.basename(context.filename);
    let name;
    if (basename.endsWith('.test.mjs')) {
      name = basename.slice(0, -9);
    } else if (basename.endsWith('.config.mjs')) {
      name = basename.slice(0, -11);
    } else if (basename.endsWith('.mjs')) {
      name = basename.slice(0, -4);
    } else {
      return {};
    }
    if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
      return {};
    }
    context.report({
      loc: { line: 1, column: 0 },
      message: `Filename "${basename}" must be camelCase or PascalCase.`,
    });
    return {};
  },
};

export default [
  {
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module',
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortController: 'readonly',
        console: 'readonly',
        // Node globals
        process: 'readonly',
        Buffer: 'readonly',
        // Jest globals
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    plugins: {
      local: {
        rules: {
          'filename-case': filenameCaseRule,
        },
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
      camelcase: ['error', { properties: 'never' }],
      'local/filename-case': 'error',
    },
  },
];
