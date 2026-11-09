import sans from '@fontsource/source-sans-pro/files/source-sans-pro-latin-400-normal.woff2?inline'
import sansSemibold from '@fontsource/source-sans-pro/files/source-sans-pro-latin-600-normal.woff2?inline'
import mono from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?inline'

export const VISUAL_FONT_CSS = `@font-face{font-family:'Source Sans Pro';src:url('${sans}') format('woff2');font-display:swap}` +
  `@font-face{font-family:'Source Sans Pro';font-weight:600;src:url('${sansSemibold}') format('woff2');font-display:swap}` +
  `@font-face{font-family:'JetBrains Mono';src:url('${mono}') format('woff2');font-display:swap}`
