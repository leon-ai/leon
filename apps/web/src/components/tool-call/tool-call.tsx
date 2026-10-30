import { useId, useState } from 'react'
import { clsx } from 'clsx'

import type { FeedToolCall } from '@/data/feed'
import { formatToolDuration } from '@/utils/format-tool-duration'
import { ActivityWave } from '@/components/activity-wave'
import { Collapse } from '@/components/collapse'
import { JsonView } from '@/components/json-view'

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

/**
 * Shows a tool invocation, its execution state, and expandable input and output.
 */
export function ToolCall({ toolCall }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const detailsId = useId()
  const isActive = toolCall.status === 'preparing' || toolCall.status === 'running'
  const duration = isActive
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

  return (
    <section className={clsx('tool-call', `tool-call-${toolCall.status}`)}>
      <button
        type="button"
        className="tool-call-trigger"
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        onClick={() => setIsExpanded((isOpen) => !isOpen)}
      >
        <ActivityWave
          active={isActive}
          className="tool-call-heading-layer"
        >
          <i
            className={`tool-call-tool-icon ri-${toolCall.toolIconName}`}
            aria-hidden="true"
          />
          <span className="tool-call-title">{toolCall.toolCallTitle}</span>
        </ActivityWave>
        {toolCall.status === 'preparing' && (
          <span className="tool-call-duration">Preparing call</span>
        )}
        {duration && (
          <span
            className="tool-call-duration"
            title={isBackground
              ? 'Time to return the execution handle; the job is still running.'
              : 'Execution time, including tool setup and transport.'}
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
