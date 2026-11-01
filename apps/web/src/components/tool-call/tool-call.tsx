import { useId, useMemo, useState } from 'react'
import { clsx } from 'clsx'

import type { FeedToolCall } from '@/data/feed'
import { formatToolDuration } from '@/utils/format-tool-duration'
import { ActivityWave } from '@/components/activity-wave'
import { Collapse } from '@/components/collapse'
import { useToolCallContents } from '@/data/conversation-details'
import { ActivityTimestamp, forwardTimestampClickToDisclosure } from '@/components/activity-timestamp'
import { toToolContent } from '@/utils/tool-content'
import { Button } from '@/components/button'
import { useOpenToolDetails } from './tool-details-provider'
import { ToolOutput } from './tool-output'

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
  const disclosure = useToolCallContents(toolCall.id, isExpanded)
  const liveOutput = useMemo(() => toToolContent(toolCall.output), [toolCall.output])
  const output = liveOutput ?? disclosure.data?.output
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

  const openDetails = useOpenToolDetails(toolCall, technicalTitle)

  return (
    <section className={clsx('tool-call', `tool-call-${toolCall.status}`)}>
      <div className="tool-call-heading" onClick={forwardTimestampClickToDisclosure}>
        <button
          type="button"
          className="tool-call-trigger"
          aria-expanded={isExpanded}
          aria-controls={detailsId}
          aria-description={toolCall.status === 'error' ? 'Tool call failed' : undefined}
          onClick={() => setIsExpanded((isOpen) => !isOpen)}
        >
          <span className="tool-call-label">
            <ActivityWave
              active={isActive}
              className="tool-call-heading-layer"
            >
              <i
                className={`tool-call-tool-icon ri-${toolCall.toolIconName}`}
                aria-hidden="true"
              />
              <span className="tool-call-title">{toolCall.toolCallTitle || formatFunctionName(toolCall.functionName)}</span>
              {toolCall.status === 'error' && (
                <i className="tool-call-error-indicator ri-close-line" aria-hidden="true" />
              )}
            </ActivityWave>
            {duration && (
              <span
                className="tool-call-duration activity-metadata"
                title={isBackground
                  ? 'Time to return the execution handle; the job is still running.'
                  : 'Execution time, including tool setup and transport.'}
              >
                {isBackground ? `${duration} to return` : duration}
              </span>
            )}
          </span>
          <i
            className="tool-call-chevron ri-arrow-right-s-line"
            aria-hidden="true"
          />
        </button>
        <ActivityTimestamp timestamp={toolCall.startedAt ?? toolCall.preparationStartedAt} />
      </div>
      <Collapse id={detailsId} isOpen={isExpanded}>
        <div className="tool-call-details">
          <div className="tool-call-details-heading">
            <p className="tool-call-details-title">{technicalTitle}</p>
            <Button iconName="expand-diagonal" tone="muted" tooltipMessage="View details"
              tooltipPosition="left" onClick={openDetails} />
          </div>
          {disclosure.isError && <button type="button" onClick={() => void disclosure.refetch()}>Retry loading tool details</button>}
          <div className="tool-call-output-frame">
            <ToolOutput content={output} label="Tool output" active={isActive}
              loading={disclosure.isFetching} preview />
          </div>
        </div>
      </Collapse>
    </section>
  )
}
