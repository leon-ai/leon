import { clsx } from 'clsx'

import { DottedIcon } from '../dotted-icon'
import { ProcessGroup } from '../process-group'
import { StreamingText, useAnimateOnce } from '../streaming-text'

import './thinking-message.sass'

interface ThinkingMessageProps {
  animationId: string
  details: string[]
  durationMs: number
  isActive: boolean
}

const MILLISECONDS_PER_SECOND = 1_000
const MILLISECONDS_PER_MINUTE = 60_000
const MILLISECONDS_PER_HOUR = 3_600_000
const BRAIN_MASK_SOURCE = '/img/logo-for-dark-bg.svg'
const BRAIN_SOURCE_WIDTH = 44
const BRAIN_SOURCE_HEIGHT = 46
const BRAIN_DOT_COLUMN_COUNT = 18

function formatDuration(durationMs: number): string {
  if (durationMs < MILLISECONDS_PER_MINUTE) {
    const seconds = Math.max(
      1,
      Math.round(durationMs / MILLISECONDS_PER_SECOND)
    )

    return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
  }

  if (durationMs < MILLISECONDS_PER_HOUR) {
    const minutes = Math.max(
      1,
      Math.round(durationMs / MILLISECONDS_PER_MINUTE)
    )

    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  }

  const hours = Math.max(1, Math.round(durationMs / MILLISECONDS_PER_HOUR))

  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

export function ThinkingMessage({
  animationId,
  details,
  durationMs,
  isActive
}: ThinkingMessageProps) {
  const shouldAnimateHeading = useAnimateOnce(`${animationId}:heading`)
  const detailText = details.join('\n')

  return (
    <div className={clsx('thinking-message', {
      'thinking-message-animate': shouldAnimateHeading
    })}>
      <ProcessGroup
        active={isActive}
        activeIndicator={(
          <DottedIcon
            active={isActive}
            ariaLabel="Leon is thinking"
            columnCount={BRAIN_DOT_COLUMN_COUNT}
            maskMode="light"
            source={BRAIN_MASK_SOURCE}
            sourceHeight={BRAIN_SOURCE_HEIGHT}
            sourceWidth={BRAIN_SOURCE_WIDTH}
          />
        )}
        activeLabel="Thinking..."
        ariaLabel="Leon’s thinking"
        completedIndicator={(
          <span className="thinking-message-completed-icon" />
        )}
        completedLabel={`Thought for ${formatDuration(durationMs)}`}
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
