import { MarkdownContent } from '@/components/markdown-content'
import { MessageMetadata } from '@/components/message-metadata'
import type { ConversationMetrics } from '@/data/conversation'
import type { ReactNode } from 'react'

import './final-answer.sass'

const FINAL_ANSWER_ANIMATION_DELAY = 1_000

interface FinalAnswerProps {
  animationId: string
  children: string
  timestamp?: number | undefined
  metrics?: ConversationMetrics | undefined
  footer?: ReactNode
  active?: boolean | undefined
}

export function FinalAnswer({
  animationId,
  children,
  timestamp,
  metrics,
  footer,
  active
}: FinalAnswerProps) {
  return (
    <div className="final-answer">
      <section className="final-answer-body" aria-label="Leon’s final answer">
        <MarkdownContent
          animationId={animationId}
          active={active}
          startDelay={FINAL_ANSWER_ANIMATION_DELAY}
          text={children}
        />
      </section>
      {footer}
      <MessageMetadata role="leon" text={children} timestamp={timestamp} metrics={metrics} />
    </div>
  )
}
