import { useId, useState } from 'react'
import { clsx } from 'clsx'

import type { FeedToolCall } from '../../data/feed'
import { JsonView } from '../json-view'
import { useAnimateOnce } from '../streaming-text'

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
  const shouldAnimate = useAnimateOnce(`${toolCall.id}:tool-call`)
  const technicalTitle = [
    toolCall.toolkitName,
    toolCall.toolName,
    formatFunctionName(toolCall.functionName)
  ].join(' - ')

  return (
    <section className={clsx(
      'tool-call',
      `tool-call-${toolCall.status}`,
      { 'tool-call-animate': shouldAnimate }
    )}>
      <button
        type="button"
        className="tool-call-trigger"
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        onClick={() => setIsExpanded((isOpen) => !isOpen)}
      >
        <i
          className={`tool-call-tool-icon ri-${toolCall.toolIconName}`}
          aria-hidden="true"
        />
        <span className="tool-call-title">{toolCall.toolCallTitle}</span>
        <i
          className="tool-call-chevron ri-arrow-right-s-line"
          aria-hidden="true"
        />
      </button>
      {isExpanded && (
        <div id={detailsId} className="tool-call-details">
          <p className="tool-call-details-title">{technicalTitle}</p>
          <JsonView label="Input" value={toolCall.input} />
          <JsonView
            label="Output"
            value={toolCall.output ?? { status: toolCall.status }}
          />
        </div>
      )}
    </section>
  )
}
