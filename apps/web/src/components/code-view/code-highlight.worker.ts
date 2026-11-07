import type { LiveTokenizer } from '@pierre/highlights'

import type { HighlightRequest, HighlightResponse } from './code-highlight-types'
import { MAXIMUM_CODE_LINE_CHARACTERS } from './code-highlight-types'
import { CODE_THEMES } from './code-theme'

const MAXIMUM_DOCUMENTS = 8
const documents = new Map<string, { tokenizer: LiveTokenizer, text: string, language: string }>()
const pending = new Map<string, HighlightRequest>()
let engine: Promise<typeof import('@pierre/highlights')> | undefined

self.onmessage = async (event: MessageEvent<HighlightRequest>): Promise<void> => {
  let request = event.data
  const { id } = request
  const queued = pending.has(id)
  // Streaming can continue during a cold download. Retain only each viewer's
  // latest revision, including disposal requests, rather than every text burst.
  pending.set(id, request)
  if (queued) {
    return
  }
  let document: ReturnType<typeof documents.get>

  try {
    // Register the message handler before asynchronous Wasm initialization;
    // requests received while it loads must retain their original order.
    const { LiveTokenizer, isSupportedLanguage } = await (engine ??= import('@pierre/highlights'))
    request = pending.get(id)!
    pending.delete(id)
    const { revision, text, language } = request
    document = documents.get(id)
    if (text === undefined || !language || !isSupportedLanguage(language)) {
      document?.tokenizer.dispose()
      documents.delete(id)
      return
    }
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
      document = { tokenizer: new LiveTokenizer({ code: text, lang: language, themes: CODE_THEMES, defaultColor: 'light-dark()',
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
      document!.tokenizer.getLineTokens(line).tokens.map(({ content, color, htmlStyle }) => {
        const tokenColor = htmlStyle?.['color'] ?? color

        return tokenColor ? { content, color: tokenColor } : { content }
      }))
    self.postMessage({ id, revision, lines } satisfies HighlightResponse)
  } catch {
    request = pending.get(id) ?? request
    pending.delete(id)
    document?.tokenizer.dispose()
    documents.delete(id)
    self.postMessage({ id, revision: request.revision, lines: null } satisfies HighlightResponse)
  }
}
