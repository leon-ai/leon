import { clsx } from 'clsx'

import { StreamingText, useAnimateOnce } from '../streaming-text'

import './bonus-response.sass'

const BONUS_RESPONSE_ANIMATION_DELAY = 2_700

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
      aria-label="Leon’s bonus response"
    >
      <span className="bonus-response-icon" aria-hidden="true" />
      <StreamingText
        animationId={`${animationId}:text`}
        className="bonus-response-text"
        startDelay={BONUS_RESPONSE_ANIMATION_DELAY}
        text={children}
      />
    </aside>
  )
}
