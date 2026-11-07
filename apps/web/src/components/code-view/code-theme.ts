import type { CSSProperties } from 'react'
import dark from '@pierre/highlights/themes/pierre-dark'
import light from '@pierre/highlights/themes/pierre-light'

export const CODE_THEMES = { dark, light }

// Browser color-scheme changes both palettes atomically without another lexer pass.
export const CODE_THEME_STYLE = {
  '--code-background': `light-dark(var(--color-surface-elevated), ${dark.style['editor.background']})`,
  '--code-foreground': `light-dark(${light.style['editor.foreground']}, ${dark.style['editor.foreground']})`
} as CSSProperties
