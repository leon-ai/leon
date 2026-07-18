import stylistic from '@stylistic/eslint-plugin'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import unicorn from 'eslint-plugin-unicorn'
import {
  createNodeResolver,
  importX
} from 'eslint-plugin-import-x'
import {
  createTypeScriptImportResolver
} from 'eslint-import-resolver-typescript'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'
import js from '@eslint/js'

export default [
  {
    ignores: ['**/*.spec.js', 'aurora/dist/**']
  },
  js.configs.recommended,
  ...typescriptEslint.configs['flat/recommended'],
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    plugins: {
      '@stylistic': stylistic,
      unicorn
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      },
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver(),
        createNodeResolver()
      ]
    },
    rules: {
      // Preserve the existing cleanup patterns until they can be reviewed
      // independently from the ESLint dependency upgrade.
      'no-useless-assignment': 'off',
      // Leon often converts infrastructure failures into domain-specific
      // errors whose public messages intentionally omit the original cause.
      'preserve-caught-error': 'off',
      '@typescript-eslint/no-non-null-assertion': ['off'],
      'no-async-promise-executor': ['off'],
      'no-underscore-dangle': [
        'error',
        {
          allowAfterThis: true
        }
      ],
      'prefer-destructuring': ['off'],
      '@stylistic/comma-dangle': ['error', 'never'],
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      'unicorn/prefer-node-protocol': 'error',
      '@stylistic/member-delimiter-style': [
        'error',
        {
          multiline: {
            delimiter: 'none',
            requireLast: true
          },
          singleline: {
            delimiter: 'comma',
            requireLast: false
          }
        }
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/consistent-type-definitions': 'error',
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
      'import-x/order': 'off'
    }
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error'
    }
  }
]
