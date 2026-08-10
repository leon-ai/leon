import { Fragment, type ReactNode } from 'react'

import type { JsonValue } from '../../data/feed'

import './json-view.sass'

const JSON_INDENTATION_SIZE = 2

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

export function JsonView({ label, value }: JsonViewProps) {
  return (
    <div className="json-view">
      <span className="json-view-label">{label}</span>
      <pre className="json-view-code" aria-label={`${label} JSON`}>
        <code>{renderJsonValue(value)}</code>
      </pre>
    </div>
  )
}

