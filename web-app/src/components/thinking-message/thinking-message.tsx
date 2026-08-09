import { clsx } from 'clsx'

import { StreamingText, useAnimateOnce } from '../streaming-text'
import { ThinkingBrain } from '../thinking-brain'

import './thinking-message.sass'

interface ThinkingMessageProps {
  animationId: string
  details: string[]
  isActive: boolean
}

export function ThinkingMessage({
  animationId,
  details,
  isActive
}: ThinkingMessageProps) {
  const shouldAnimateHeading = useAnimateOnce(`${animationId}:heading`)

  return (
    <section className="thinking-message" aria-label="Leon’s thinking">
      <div className={clsx('thinking-message-heading', {
        'thinking-message-heading-animate': shouldAnimateHeading
      })}>
        <ThinkingBrain active={isActive} />
        <h2 className="thinking-message-title">Thinking...</h2>
      </div>
      <StreamingText
        animationId={animationId}
        className="thinking-message-details"
        startDelay={120}
        text={details.join('\n')}
      />
    </section>
  )
}
