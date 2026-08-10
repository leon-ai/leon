import { clsx } from 'clsx'

import type { LeonFeedEntry } from '../../data/feed'
import { FinalAnswer } from '../final-answer'
import { StreamingText, useAnimateOnce } from '../streaming-text'
import { TaskList } from '../task-list'
import { ThinkingMessage } from '../thinking-message'
import { ToolCallList } from '../tool-call-list'

import './leon-message.sass'

interface LeonMessageProps {
  entry: LeonFeedEntry
}

export function LeonMessage({ entry }: LeonMessageProps) {
  const shouldAnimateExecution = useAnimateOnce(`${entry.id}:execution`)

  return (
    <div className="leon-message">
      <ThinkingMessage
        animationId={`${entry.id}:thinking`}
        details={entry.thinking.details}
        isActive={entry.thinking.isActive}
      />
      <p className="leon-message-summary">
        <StreamingText
          animationId={`${entry.id}:summary`}
          startDelay={420}
          text={entry.summary}
        />
      </p>
      <div className={clsx('leon-message-execution', {
        'leon-message-execution-animate': shouldAnimateExecution
      })}>
        {entry.plan !== undefined ? (
          <TaskList steps={entry.plan} />
        ) : (
          <ToolCallList toolCalls={entry.toolCalls ?? []} />
        )}
      </div>
      {entry.finalAnswer.trim().length > 0 && (
        <FinalAnswer animationId={`${entry.id}:final-answer`}>
          {entry.finalAnswer}
        </FinalAnswer>
      )}
    </div>
  )
}
