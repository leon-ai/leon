import { Icon } from '@/components/icon'
import { useId, useMemo, useState, type CSSProperties, type Ref } from 'react'
import { clsx } from 'clsx'

import type { FeedToolCall } from '@/data/feed'
import { formatToolDuration } from '@/utils/format-tool-duration'
import { ActivityWave } from '@/components/activity-wave'
import { Collapse } from '@/components/collapse'
import { useToolCallContents } from '@/data/conversation-details'
import { ActivityTimestamp, forwardTimestampClickToDisclosure } from '@/components/activity-timestamp'
import { ActivityDetails } from '@/components/activity-details/activity-details'
import { toToolContent, toToolInput } from '@/utils/tool-content'
import { getToolChanges, hasToolChanges } from '@/utils/tool-changes'
import { ToolChanges, ToolOutput } from './tool-output'
import { useOpenToolDetails } from '@/components/activity-details/activity-details-provider'

import './tool-call.sass'

interface ToolCallProps {
  toolCall: FeedToolCall
  measureRef?: Ref<HTMLElement>
  rowIndex?: number
  style?: CSSProperties
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
export function ToolCall({ toolCall, measureRef, rowIndex, style }: ToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const disclosure = useToolCallContents(toolCall.id, isExpanded)
  const liveOutput = useMemo(() => toToolContent(toolCall.output), [toolCall.output])
  const liveCommand = useMemo(() => toToolContent(toolCall.commandOutput, false, true), [toolCall.commandOutput])
  const command = liveCommand ?? disclosure.data?.commandOutput ?? disclosure.data?.displayOutput
  const output = command ?? liveOutput ?? disclosure.data?.output
  const liveInput = useMemo(() => toToolInput(toolCall.input === null ? undefined : toolCall.input), [toolCall.input])
  const changesAvailable = toolCall.status === 'success' && (hasToolChanges(toolCall.output) || disclosure.data?.hasChanges === true)
  const input = liveInput ?? disclosure.data?.input
  const changes = useMemo(() => getToolChanges(input, changesAvailable), [input, changesAvailable])
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
    <section ref={measureRef} data-index={rowIndex} style={style} className={clsx('tool-call', `tool-call-${toolCall.status}`)}>
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
              <Icon name={toolCall.toolIconName} fallbackName={toolCall.toolkitIconName} className="tool-call-tool-icon" />
              <span className="tool-call-title">{toolCall.toolCallTitle || formatFunctionName(toolCall.functionName)}</span>
              {toolCall.status === 'error' && (
                <Icon name="close-line" className="tool-call-error-indicator" />
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
          <Icon name="arrow-right-s-line" className="tool-call-chevron" />
        </button>
        <ActivityTimestamp timestamp={toolCall.startedAt ?? toolCall.preparationStartedAt} />
      </div>
      <Collapse id={detailsId} isOpen={isExpanded}>
        <ActivityDetails title={technicalTitle} onViewDetails={openDetails} notice={
          disclosure.isError && <button type="button" onClick={() => void disclosure.refetch()}>Retry loading tool details</button>
        }>
          {changes.length > 0 ? (
            <ToolChanges changes={changes} truncated={disclosure.data?.diffTruncated ?? false} preview
              fallback={<ToolOutput content={output} label="Tool output" preview />} />
          ) : (
            <ToolOutput content={output} label="Tool output" active={isActive}
              loading={disclosure.isFetching} preview
              previewTail={liveCommand !== undefined || disclosure.data?.commandOutput !== undefined} />
          )}
        </ActivityDetails>
      </Collapse>
    </section>
  )
}
