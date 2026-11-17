import { Lexer } from 'marked'

import { markdownToText } from '@/helpers/markdown-helper'
import { UPDATE_CHANGELOG_SECTIONS, type ReleaseChangeScope } from '@@/bridges/runtime/contracts/updates'

const FULL_CHANGELOG_HEADING = 'full changelog'

/**
 * Preserves authored Markdown while separating owner-facing highlights from
 * categorized details. Older releases may use Improved/Fixed section headings.
 */
export function parseReleaseNotes(markdown: string): {
  highlights: string
  changelog: Record<ReleaseChangeScope, string>
} {
  const changelog: Record<ReleaseChangeScope, string> = { new: '', improvements: '', fixes: '', removed: '' }
  let highlights = ''
  let scope: ReleaseChangeScope | null = null
  for (const token of Lexer.lex(markdown)) {
    if (token.type === 'heading') {
      const heading = markdownToText(token.text).trim().toLowerCase()
      if (heading === FULL_CHANGELOG_HEADING) {
        scope = null
        continue
      }
      const category = UPDATE_CHANGELOG_SECTIONS.find((section) => section.headings.some((label) => label === heading))
      if (category) {
        scope = category.id
        continue
      }
    }
    if (scope) {
      changelog[scope] += token.raw
    } else {
      highlights += token.raw
    }
  }

  for (const section of UPDATE_CHANGELOG_SECTIONS) {
    changelog[section.id] = changelog[section.id].trim()
  }

  return { highlights: highlights.trim(), changelog }
}
