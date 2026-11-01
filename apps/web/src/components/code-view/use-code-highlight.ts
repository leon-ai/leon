import { useEffect, useRef, useState } from 'react'

import type { CodeToken, HighlightRequest, HighlightResponse } from './code-highlight-types'

const MAXIMUM_HIGHLIGHT_CHARACTERS = 65_536
const subscribers = new Map<string, (response: HighlightResponse) => void>()
let worker: Worker | undefined

function getWorker(): Worker | undefined {
  if (!worker) {
    try {
      worker = new Worker(new URL('./code-highlight.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<HighlightResponse>): void => {
        subscribers.get(event.data.id)?.(event.data)
      }
      worker.onerror = (event): void => {
        // Text remains readable if Wasm, workers, or their CSP permissions fail.
        event.preventDefault()
        for (const [id, receive] of subscribers) {
          receive({ id, revision: -1, lines: null })
        }
        worker?.terminate()
        worker = undefined
      }
    } catch {
      return undefined
    }
  }

  return worker
}

/**
 * Shares a lazily loaded syntax worker, ignores stale replies, and releases its
 * lexer state when viewers close. Oversized text remains virtualized plain text.
 */
export function useCodeHighlight(text: string, language: string): CodeToken[][] | null {
  const id = useRef(crypto.randomUUID())
  const revision = useRef(0)
  const requested = useRef({ text, language })
  const [result, setResult] = useState<{ text: string, language: string, lines: CodeToken[][] | null } | null>(null)
  const enabled = language !== 'text' && text.length <= MAXIMUM_HIGHLIGHT_CHARACTERS

  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    const currentId = id.current
    subscribers.set(currentId, (response) => {
      if (response.revision === revision.current || response.revision === -1) {
        setResult({ ...requested.current, lines: response.lines })
      }
    })

    return (): void => {
      subscribers.delete(currentId)
      if (subscribers.size === 0) {
        worker?.terminate()
        worker = undefined
      } else {
        worker?.postMessage({ id: currentId, revision: revision.current } satisfies HighlightRequest)
      }
    }
  }, [enabled])

  useEffect(() => {
    if (enabled) {
      requested.current = { text, language }
      getWorker()?.postMessage({ id: id.current, revision: ++revision.current, text, language } satisfies HighlightRequest)
    }
  }, [text, language, enabled])

  return enabled && result?.text === text && result.language === language ? result.lines : null
}
