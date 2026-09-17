import js from '@eslint/js'
import jsdoc from 'eslint-plugin-jsdoc'
import n from 'eslint-plugin-n'
import globals from 'globals'
import prettierConfig from 'eslint-config-prettier'

// lucide (PEAKUB DX initiative): replaces ESLint 6 + eslint-config-standard/-react (dead
// boilerplate - this package has never used React or JSX; that config was carried over verbatim
// from a shared template every @servable/* package started from). ESLint 6 predates flat config
// entirely and is long past its own EOL. The two things actually worth enforcing here:
//   - `n/no-missing-import` - catches the exact class of bug this whole initiative kept finding
//     by hand (a relative import missing its `.js` extension, invisible until Node's ESM loader
//     throws ERR_MODULE_NOT_FOUND at runtime) at lint time and in-editor instead.
//   - `eslint-plugin-jsdoc` - checks that JSDoc, where present, is actually correct (right
//     `@param` names, valid types); `require-jsdoc` below is a `warn` rather than an `error` so
//     it surfaces the still-undocumented corners of this codebase in-editor without failing
//     `test:lint` outright on everything this pass didn't reach.
export default [
  js.configs.recommended,
  n.configs['flat/recommended-module'],
  jsdoc.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        // Set by @servable/server at boot (never imported) - see global.d.ts's own comment.
        Servable: 'readonly',
        // Set by parse-server's own `require('parse/node')` side effect - see global.d.ts's
        // own comment.
        Parse: 'readonly',
      },
    },
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': ['warn', {
        publicOnly: true,
        require: {
          FunctionDeclaration: true,
          FunctionExpression: true,
          ArrowFunctionExpression: true,
          ClassDeclaration: true,
          MethodDefinition: false,
        },
      }],
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/require-returns': 'off',
      'n/no-unpublished-import': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.test.js', 'tests/**/*.js'],
    languageOptions: { globals: { ...globals.jest } },
    rules: { 'jsdoc/require-jsdoc': 'off' },
  },
  {
    ignores: ['build/', 'dist/', 'types/', 'node_modules/', '.snapshots/', '**/*.min.js'],
  },
  prettierConfig,
]
