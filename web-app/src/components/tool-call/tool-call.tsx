import { useId, useState } from 'react'
import { clsx } from 'clsx'

import type { FeedToolCall } from '../../data/feed'
import { formatToolDuration } from '../../utils/format-tool-duration'
import { Collapse } from '../collapse'
import { JsonView } from '../json-view'

import './tool-call.sass'

interface ToolCallProps {
  toolCall: FeedToolCall
}

function formatFunctionName(functionName: string): string {
  const characters = Array.from(functionName)
  let label = ''

  for (const [index, character] of characters.entries()) {
    if (character === '_' || character === '-') {
      label += ' '
      continue
    }

    const previousCharacter = characters[index - 1]
    const isUppercaseLetter = character.toLocaleUpperCase() === character &&
      character.toLocaleLowerCase() !== character
    const followsLowercaseLetter = previousCharacter !== undefined &&
      previousCharacter.toLocaleLowerCase() === previousCharacter &&
      previousCharacter.toLocaleUpperCase() !== previousCharacter

    if (isUppercaseLetter && followsLowercaseLetter) {
      label += ' '
    }

    label += character
  }

  return label.length === 0
    ? functionName
    : `${label[0]?.toLocaleUpperCase()}${label.slice(1)}`
}

export function ToolCall({ toolCall }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const detailsId = useId()
  const duration = toolCall.status === 'running'
    ? ''
    : formatToolDuration(toolCall.durationMs)
  const execution = toolCall.output && typeof toolCall.output === 'object' &&
    !Array.isArray(toolCall.output)
    ? toolCall.output['execution']
    : undefined
  const isBackground = execution && typeof execution === 'object' &&
    !Array.isArray(execution) && execution['state'] === 'running'
  const technicalTitle = [
    toolCall.toolkitName,
    toolCall.toolName,
    formatFunctionName(toolCall.functionName)
  ].join(' • ')
  const headingLayer = (
    className?: string,
    decorative = false
  ) => (
    <span
      className={clsx('tool-call-heading-layer', className)}
      aria-hidden={decorative || undefined}
    >
      <i
        className={`tool-call-tool-icon ri-${toolCall.toolIconName}`}
        aria-hidden="true"
      />
      <span className="tool-call-title">{toolCall.toolCallTitle}</span>
    </span>
  )

  return (
    <section className={clsx('tool-call', `tool-call-${toolCall.status}`)}>
      <button
        type="button"
        className="tool-call-trigger"
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        onClick={() => setIsExpanded((isOpen) => !isOpen)}
      >
        {toolCall.status === 'running' ? (
          <span className="tool-call-running-content">
            {headingLayer()}
            {headingLayer('tool-call-wave', true)}
          </span>
        ) : headingLayer()}
        {duration && (
          <span
            className="tool-call-duration"
            title={isBackground
              ? 'Time to return the execution handle; the job is still running.'
              : 'Tool call duration, including preparation and transport.'}
          >
            {isBackground ? `${duration} to return` : duration}
          </span>
        )}
        <i
          className="tool-call-chevron ri-arrow-right-s-line"
          aria-hidden="true"
        />
      </button>
      <Collapse id={detailsId} isOpen={isExpanded}>
        <div className="tool-call-details">
          <p className="tool-call-details-title">{technicalTitle}</p>
          <JsonView label="Input" value={toolCall.input} />
          <JsonView
            label="Output"
            value={toolCall.output ?? { status: toolCall.status }}
          />
        </div>
      </Collapse>
    </section>
  )
}
