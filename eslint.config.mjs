import stylistic from '@stylistic/eslint-plugin'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import unicorn from 'eslint-plugin-unicorn'
import importPlugin from 'eslint-plugin-import'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'
import js from '@eslint/js'

export default [
  {
    ignores: ['**/*.spec.js', 'aurora/dist/**']
  },
  js.configs.recommended,
  ...typescriptEslint.configs['flat/recommended'],
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
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
      'import/resolver': {
        typescript: true,
        node: true
      }
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': ['off'],
      'no-async-promise-executor': ['off'],
      'no-underscore-dangle': [
        'error',
        {
          allowAfterThis: true
        }
      ],
      'prefer-destructuring': ['off'],
      'comma-dangle': ['error', 'never'],
      '@stylistic/comma-dangle': ['error', 'never'],
      semi: ['error', 'never'],
      quotes: ['error', 'single'],
      '@stylistic/quotes': ['error', 'single'],
      'object-curly-spacing': ['error', 'always'],
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
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      'import/order': 'off'
    }
  },
  {
    files: ['skills/**/*.ts'],
    rules: {
      'import/order': 'off'
    }
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error'
    }
  }
]
