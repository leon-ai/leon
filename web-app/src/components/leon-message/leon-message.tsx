import { clsx } from 'clsx'

import type {
  FeedPlanActivity,
  FeedToolsActivity,
  LeonFeedActivity,
  LeonFeedEntry
} from '../../data/feed'
import { FinalAnswer } from '../final-answer'
import { ProcessGroup } from '../process-group'
import { StreamingText, useAnimateOnce } from '../streaming-text'
import { TaskList } from '../task-list'
import { ThinkingMessage } from '../thinking-message'
import { ToolCallList } from '../tool-call-list'

import './leon-message.sass'

interface LeonMessageProps {
  entry: LeonFeedEntry
}

interface ExecutionActivityProps {
  activity: FeedPlanActivity | FeedToolsActivity
}

function ExecutionActivity({ activity }: ExecutionActivityProps) {
  const shouldAnimate = useAnimateOnce(`${activity.id}:execution`)

  if (activity.type === 'plan') {
    const planIsActive = activity.steps.some((step) =>
      step.status === 'in_progress' || step.status === 'pending'
    )

    return (
      <div className={clsx('leon-message-execution', {
        'leon-message-execution-animate': shouldAnimate
      })}>
        <ProcessGroup
          active={planIsActive}
          activeLabel="Executing plan..."
          ariaLabel="Leon’s execution plan"
          completedLabel="Completed plan"
          indicator={<i className="ri-map-2-line" aria-hidden="true" />}
        >
          <TaskList steps={activity.steps} />
        </ProcessGroup>
      </div>
    )
  }

  const toolsAreActive = activity.toolCalls.some((toolCall) =>
    toolCall.status === 'running'
  )
  const toolCount = activity.toolCalls.length

  return (
    <div className={clsx('leon-message-execution', {
      'leon-message-execution-animate': shouldAnimate
    })}>
      <ProcessGroup
        active={toolsAreActive}
        activeLabel="Using tools..."
        ariaLabel="Leon’s tool usage"
        completedLabel={`Used ${toolCount} ${
          toolCount === 1 ? 'tool' : 'tools'
        }`}
        indicator={(
          <i className="ri-pencil-ruler-2-line" aria-hidden="true" />
        )}
      >
        <ToolCallList toolCalls={activity.toolCalls} />
      </ProcessGroup>
    </div>
  )
}

function renderActivity(activity: LeonFeedActivity) {
  if (activity.type === 'thinking') {
    return (
      <ThinkingMessage
        key={activity.id}
        animationId={activity.id}
        details={activity.details}
        durationMs={activity.durationMs}
        isActive={activity.isActive}
      />
    )
  }

  if (activity.type === 'summary') {
    return (
      <p key={activity.id} className="leon-message-summary">
        <StreamingText
          animationId={activity.id}
          startDelay={420}
          text={activity.content}
        />
      </p>
    )
  }

  return <ExecutionActivity key={activity.id} activity={activity} />
}

export function LeonMessage({ entry }: LeonMessageProps) {
  return (
    <div className="leon-message">
      {entry.activities.map(renderActivity)}
      {entry.finalAnswer.trim().length > 0 && (
        <FinalAnswer animationId={`${entry.id}:final-answer`}>
          {entry.finalAnswer}
        </FinalAnswer>
      )}
    </div>
  )
}
