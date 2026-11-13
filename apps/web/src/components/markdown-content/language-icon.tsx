import { memo } from 'react'
import { FileIcon } from '@/components/icon'
import { Tooltip } from '@/components/tooltip'
import languageIcons from '@/components/icon/file-icon-languages.json'

// Fence names are not filenames; the shared registry owns file-type matching.
const LANGUAGES: Readonly<Record<string, { fileName: string, label: string }>> = {
  ...languageIcons,
  text: { fileName: 'code.txt', label: 'Plain text' }
}
const ALIASES: Record<string, string> = { html5: 'html', docker: 'dockerfile', txt: 'text', plain: 'text', plaintext: 'text' }

/**
 * Adapts Markdown fence names to the shared, lazily loaded file-icon registry.
 */
export const LanguageIcon = memo(function LanguageIcon({ language }: { language: string }) {
  const normalized = language.toLowerCase()
  const key = Object.hasOwn(ALIASES, normalized) ? ALIASES[normalized]! : normalized
  const known = Object.hasOwn(LANGUAGES, key) ? LANGUAGES[key] : undefined
  const label = known?.label ?? language

  return <Tooltip message={label} position="top" blurOnClick={false}>
    <span className="markdown-language-icon" tabIndex={0}>
      <FileIcon fileName={known?.fileName ?? `code.${key}`} ariaLabel={label} fallbackLabel={label} />
    </span>
  </Tooltip>
})
