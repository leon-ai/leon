import { Fragment, useMemo, useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { JsonValue } from '@/data/feed'

import './json-view.sass'

const JSON_INDENTATION_SIZE = 2
const LARGE_JSON_CHARACTER_COUNT = 16_384
const MAXIMUM_LINE_CHARACTERS = 160
const JSON_LINE_HEIGHT_PX = 18

interface JsonViewProps {
  label: string
  value: JsonValue
}

function getIndentation(depth: number): string {
  return ' '.repeat(depth * JSON_INDENTATION_SIZE)
}

function renderJsonValue(value: JsonValue, depth = 0): ReactNode {
  if (value === null) {
    return <span className="json-view-null">null</span>
  }

  if (typeof value === 'string') {
    return <span className="json-view-string">{JSON.stringify(value)}</span>
  }

  if (typeof value === 'number') {
    return <span className="json-view-number">{value}</span>
  }

  if (typeof value === 'boolean') {
    return <span className="json-view-boolean">{String(value)}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="json-view-punctuation">[]</span>
    }

    return (
      <>
        <span className="json-view-punctuation">{'[\n'}</span>
        {value.map((item, index) => (
          <Fragment key={index}>
            {getIndentation(depth + 1)}
            {renderJsonValue(item, depth + 1)}
            <span className="json-view-punctuation">
              {index === value.length - 1 ? '\n' : ',\n'}
            </span>
          </Fragment>
        ))}
        {getIndentation(depth)}
        <span className="json-view-punctuation">]</span>
      </>
    )
  }

  const entries = Object.entries(value)

  if (entries.length === 0) {
    return <span className="json-view-punctuation">{'{}'}</span>
  }

  return (
    <>
      <span className="json-view-punctuation">{'{\n'}</span>
      {entries.map(([key, item], index) => (
        <Fragment key={key}>
          {getIndentation(depth + 1)}
          <span className="json-view-key">{JSON.stringify(key)}</span>
          <span className="json-view-punctuation">: </span>
          {renderJsonValue(item, depth + 1)}
          <span className="json-view-punctuation">
            {index === entries.length - 1 ? '\n' : ',\n'}
          </span>
        </Fragment>
      ))}
      {getIndentation(depth)}
      <span className="json-view-punctuation">{'}'}</span>
    </>
  )
}

function VirtualJson({ text, label }: { text: string, label: string }) {
  const scrollRef = useRef<HTMLPreElement>(null)
  const lines = useMemo(() => text.split('\n').flatMap((line) => {
    const chunks: string[] = []
    for (let offset = 0; offset < Math.max(1, line.length); offset += MAXIMUM_LINE_CHARACTERS) {
      chunks.push(line.slice(offset, offset + MAXIMUM_LINE_CHARACTERS))
    }

    return chunks
  }), [text])
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => JSON_LINE_HEIGHT_PX,
    overscan: 5
  })

  return (
    <pre ref={scrollRef} className="json-view-code" aria-label={`${label} JSON`}>
      <code className="json-view-virtual" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((row) => (
          <span key={row.index} className="json-view-line" style={{
            height: `${row.size}px`, transform: `translateY(${row.start}px)`
          }}>{lines[row.index]}</span>
        ))}
      </code>
    </pre>
  )
}

export function JsonView({ label, value }: JsonViewProps) {
  const serialized = useMemo(() => JSON.stringify(value, null, JSON_INDENTATION_SIZE), [value])

  return (
    <div className="json-view">
      <span className="json-view-label">{label}</span>
      {serialized.length > LARGE_JSON_CHARACTER_COUNT ? <VirtualJson text={serialized} label={label} /> : (
        <pre className="json-view-code" aria-label={`${label} JSON`}>
        <code>{renderJsonValue(value)}</code>
        </pre>
      )}
    </div>
  )
}

