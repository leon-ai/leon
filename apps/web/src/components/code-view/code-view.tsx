import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { ScrollContainer } from '@/components/scroll-container'
import { useCodeHighlight } from './use-code-highlight'
import { CODE_PREVIEW_LINES, MAXIMUM_CODE_LINE_CHARACTERS, type CodeToken } from './code-highlight-types'

import '@fontsource/jetbrains-mono/latin-400.css'
import './code-view.sass'

const CODE_LINE_HEIGHT_PX = 22
const FOLLOW_TOLERANCE_PX = 24

interface CodeViewProps {
  text: string
  label: string
  language?: string
  active?: boolean
  preview?: boolean
  previewTail?: boolean
  truncated?: boolean
}

interface CodeRow {
  text: string
  line: number
  offset: number
}

function getRowTokens(row: CodeRow, tokens: CodeToken[][] | null): CodeToken[] | undefined {
  const lineTokens = tokens?.[row.line]
  if (!lineTokens) {
    return undefined
  }
  let offset = 0

  // Display chunks retain their source-line offsets; a long JSON string must
  // not invalidate the highlighting of every other line in the document.
  return lineTokens.flatMap((token) => {
    const start = Math.max(0, row.offset - offset)
    const end = Math.min(token.content.length, row.offset + row.text.length - offset)
    offset += token.content.length

    return end > start ? [{ ...token, content: token.content.slice(start, end) }] : []
  })
}

/**
 * Renders only visible output lines, bounds pathological single-line payloads,
 * and follows live output only while its reader remains at the end.
 */
export function CodeView({ text, label, language = 'text', active = false, preview = false, previewTail = false, truncated = false }: CodeViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const rows = useMemo(() => text.split('\n').flatMap((text, line) => {
    const chunks: CodeRow[] = []
    for (let offset = 0; offset < Math.max(1, text.length); offset += MAXIMUM_CODE_LINE_CHARACTERS) {
      chunks.push({ text: text.slice(offset, offset + MAXIMUM_CODE_LINE_CHARACTERS), line, offset })
    }

    return chunks
  }), [text])
  const tokens = useCodeHighlight(text, language)
  const virtualizer = useVirtualizer({
    count: rows.length,
    enabled: !preview,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => CODE_LINE_HEIGHT_PX,
    overscan: 5
  })

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!preview && active && followRef.current && viewport) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [text, active, preview])

  function renderRow(row: CodeRow) {
    return getRowTokens(row, tokens)?.map((token, index) => (
      <span key={index} style={token.color ? { color: token.color } : undefined}>{token.content}</span>
    )) ?? row.text
  }

  if (preview) {
    const omitted = truncated || rows.length > CODE_PREVIEW_LINES
    // The omission marker shares the preview budget so long output stays bounded.
    const visibleCount = CODE_PREVIEW_LINES - (omitted ? 1 : 0)
    const visibleRows = previewTail ? rows.slice(-visibleCount) : rows.slice(0, visibleCount)
    const ellipsis = omitted ? (
      <span className="code-view-line code-view-ellipsis"
        aria-label={previewTail ? 'Earlier content omitted' : 'More content omitted'}>…{'\n'}</span>
    ) : null

    return (
      <div className="code-view code-view-preview code-view-viewport" role="region" aria-label={label} tabIndex={0}
        style={{ '--code-preview-lines': CODE_PREVIEW_LINES } as CSSProperties}>
        <pre className="code-view-content"><code>
          {previewTail && ellipsis}
          {visibleRows.map((row) => (
            <span key={`${row.line}:${row.offset}`} className="code-view-line">{renderRow(row)}{'\n'}</span>
          ))}
          {!previewTail && ellipsis}
        </code></pre>
      </div>
    )
  }

  return (
    <ScrollContainer
      className="code-view"
      scrollRef={viewportRef}
      viewportClassName="code-view-viewport"
      aria-label={label}
      role="region"
      tabIndex={0}
      onScroll={(event) => {
        const viewport = event.currentTarget
        followRef.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < FOLLOW_TOLERANCE_PX
      }}
    >
      <pre className="code-view-content" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        <code>
          {virtualizer.getVirtualItems().map((row) => (
            <span key={row.index} className="code-view-line" style={{ transform: `translateY(${row.start}px)` }}>
              {renderRow(rows[row.index]!)}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </ScrollContainer>
  )
}
