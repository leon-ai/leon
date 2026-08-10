import { StreamingText } from '../streaming-text'

import './final-answer.sass'

const FINAL_ANSWER_ANIMATION_DELAY = 1_000

interface FinalAnswerProps {
  animationId: string
  children: string
}

export function FinalAnswer({
  animationId,
  children
}: FinalAnswerProps) {
  return (
    <section className="final-answer" aria-label="Leon’s final answer">
      <StreamingText
        animationId={animationId}
        startDelay={FINAL_ANSWER_ANIMATION_DELAY}
        text={children}
      />
    </section>
  )
}
