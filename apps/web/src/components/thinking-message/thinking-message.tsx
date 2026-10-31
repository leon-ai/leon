import { clsx } from 'clsx'
import { useState } from 'react'
import { useConversationDetails } from '@/data/conversation-details'

import { DurationFormat, formatToolDuration } from '@/utils/format-tool-duration'
import { ProcessGroup } from '@/components/process-group'
import { StreamingText, useAnimateOnce } from '@/components/streaming-text'
import { ThoughtIcon } from '@/components/thought-icon'
import { WorkingMessage } from '@/components/working-message'

import './thinking-message.sass'

interface ThinkingMessageProps {
  animationId: string
  details: string[]
  durationMs: number | undefined
  isActive: boolean
}

export function ThinkingMessage({
  animationId,
  details,
  durationMs,
  isActive
}: ThinkingMessageProps) {
  const shouldAnimateHeading = useAnimateOnce(`${animationId}:heading`)
  const [detailsOpen, setDetailsOpen] = useState(isActive)
  // Live reasoning arrives through events; its optimistic response may not exist on disk yet.
  const disclosure = useConversationDetails(!isActive && detailsOpen && details.length === 0)
  const savedBlock = disclosure.data?.message?.agentResponseTrace?.reasoning?.find((block) => block.id === animationId)
  const detailText = details.length > 0 ? details.join('\n') : savedBlock?.text ?? ''
  const duration = formatToolDuration(durationMs, DurationFormat.Compact)

  if (isActive && !detailText.trim()) {
    return <WorkingMessage phaseId={animationId} />
  }

  return (
    <div className={clsx('thinking-message', {
      'thinking-message-animate': shouldAnimateHeading
    })}>
      <ProcessGroup
        active={isActive}
        activeLabel="Thinking..."
        animateWhileActive
        ariaLabel="Leon’s thinking"
        completedLabel={duration ? `Thought for ${duration}` : 'Thought'}
        indicator={<ThoughtIcon />}
        onExpandedChange={setDetailsOpen}
      >
        <StreamingText
          animationId={animationId}
          className="thinking-message-details"
          startDelay={120}
          text={disclosure.isFetching && !detailText ? 'Loading reasoning…' : detailText}
        />
        {disclosure.isError && <button type="button" onClick={() => void disclosure.refetch()}>Retry loading reasoning</button>}
      </ProcessGroup>
    </div>
  )
}
