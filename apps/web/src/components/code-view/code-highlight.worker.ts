import { LiveTokenizer, isSupportedLanguage } from '@pierre/highlights'

import type { HighlightRequest, HighlightResponse } from './code-highlight-types'
import { MAXIMUM_CODE_LINE_CHARACTERS } from './code-highlight-types'
import { CODE_THEME } from './code-theme'

const MAXIMUM_DOCUMENTS = 8
const documents = new Map<string, { tokenizer: LiveTokenizer, text: string, language: string }>()

self.onmessage = (event: MessageEvent<HighlightRequest>): void => {
  const { id, revision, text, language } = event.data
  let document = documents.get(id)

  if (text === undefined || !language || !isSupportedLanguage(language)) {
    document?.tokenizer.dispose()
    documents.delete(id)
    return
  }

  try {
    if (document && document.language !== language) {
      document.tokenizer.dispose()
      documents.delete(id)
      document = undefined
    }

    if (!document) {
      // Bound retained lexer instances even when many disclosures are open.
      if (documents.size >= MAXIMUM_DOCUMENTS) {
        const oldest = documents.keys().next().value!
        documents.get(oldest)!.tokenizer.dispose()
        documents.delete(oldest)
      }
      document = { tokenizer: new LiveTokenizer({ code: text, lang: language, theme: CODE_THEME,
        tokenizeMaxLineLength: MAXIMUM_CODE_LINE_CHARACTERS }), text, language }
      documents.set(id, document)
    } else if (text.startsWith(document.text)) {
      const line = document.tokenizer.lineCount - 1
      const end = { line, character: document.tokenizer.getLineLength(line) }
      document.tokenizer.applyEdits([{ range: { start: end, end }, newText: text.slice(document.text.length) }])
      document.text = text
    } else {
      document.tokenizer.reset(text)
      document.text = text
    }

    const lines = Array.from({ length: document.tokenizer.lineCount }, (_, line) =>
      document!.tokenizer.getLineTokens(line).tokens.map(({ content, color }) =>
        color ? { content, color } : { content }))
    self.postMessage({ id, revision, lines } satisfies HighlightResponse)
  } catch {
    document?.tokenizer.dispose()
    documents.delete(id)
    self.postMessage({ id, revision, lines: null } satisfies HighlightResponse)
  }
}
