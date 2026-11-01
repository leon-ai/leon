import type { Theme } from '@pierre/highlights'

const syntaxColors: Record<string, string> = {
  comment: 'text-tertiary', keyword: 'pink', string: 'yellow', number: 'purple',
  boolean: 'pink', constant: 'purple', property: 'text', function: 'accent',
  type: 'purple', punctuation: 'text-tertiary', variable: 'text-secondary'
}

export const CODE_THEME: Theme = {
  name: 'leon-code', appearance: 'dark', cssVariables: {
    prefix: '--color-', defaults: { foreground: 'var(--color-text-secondary)' }
  },
  style: {
    'editor.foreground': 'text-secondary', 'editor.background': 'surface-elevated',
    syntax: syntaxColors
  }
}
