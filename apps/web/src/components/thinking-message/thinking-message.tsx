import { clsx } from 'clsx'

import { DurationFormat, formatToolDuration } from '@/utils/format-tool-duration'
import { ProcessGroup } from '@/components/process-group'
import { StreamingText, useAnimateOnce } from '@/components/streaming-text'
import { ThoughtIcon } from '@/components/thought-icon'

import './thinking-message.sass'

interface ThinkingMessageProps {
  animationId: string
  details: string[]
  durationMs: number
  isActive: boolean
}

export function ThinkingMessage({
  animationId,
  details,
  durationMs,
  isActive
}: ThinkingMessageProps) {
  const shouldAnimateHeading = useAnimateOnce(`${animationId}:heading`)
  const detailText = details.join('\n')
  const duration = formatToolDuration(durationMs, DurationFormat.Compact)

  return (
    <div className={clsx('thinking-message', {
      'thinking-message-animate': shouldAnimateHeading
    })}>
      <ProcessGroup
        active={isActive}
        activeLabel="Thinking..."
        animateWhileActive
        ariaLabel="Leon’s thinking"
        completedLabel={`Thought for ${duration}`}
        indicator={<ThoughtIcon />}
      >
        {isActive ? (
          <StreamingText
            animationId={animationId}
            className="thinking-message-details"
            startDelay={120}
            text={detailText}
          />
        ) : (
          <span className="thinking-message-details">{detailText}</span>
        )}
      </ProcessGroup>
    </div>
  )
}
