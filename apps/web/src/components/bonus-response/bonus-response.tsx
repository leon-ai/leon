import { clsx } from 'clsx'

import { StreamingText, useAnimateOnce } from '@/components/streaming-text'

import './bonus-response.sass'

interface BonusResponseProps {
  animationId: string
  children: string
}

export function BonusResponse({
  animationId,
  children
}: BonusResponseProps) {
  const shouldAnimate = useAnimateOnce(animationId)

  return (
    <aside
      className={clsx('bonus-response', {
        'bonus-response-animate': shouldAnimate
      })}
      aria-label="FYI"
    >
      <span className="bonus-response-icon" aria-hidden="true" />
      <StreamingText
        animationId={`${animationId}:text`}
        className="bonus-response-text"
        text={children}
      />
    </aside>
  )
}
