import { clsx } from 'clsx'

import type {
  FeedPlanActivity,
  FeedToolsActivity,
  LeonFeedActivity,
  LeonFeedEntry
} from '@/data/feed'
import { FeedTurnStatus } from '@/data/feed'
import { DurationFormat, formatToolDuration } from '@/utils/format-tool-duration'
import { ArtifactAttachments } from '@/components/artifact-attachments'
import { BonusResponse } from '@/components/bonus-response'
import { FinalAnswer } from '@/components/final-answer'
import { ProcessGroup } from '@/components/process-group'
import { StreamingText, useAnimateOnce } from '@/components/streaming-text'
import { TaskList } from '@/components/task-list'
import { ThinkingMessage } from '@/components/thinking-message'
import { ToolCallList } from '@/components/tool-call-list'

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
    toolCall.status === 'preparing' || toolCall.status === 'running'
  )
  const toolsAreRunning = activity.toolCalls.some((toolCall) =>
    toolCall.status === 'running'
  )
  const toolCount = activity.toolCalls.length

  return (
    <div className={clsx('leon-message-execution', {
      'leon-message-execution-animate': shouldAnimate
    })}>
      <ProcessGroup
        active={toolsAreActive}
        activeLabel={toolsAreRunning ? 'Using tools...' : 'Preparing tool calls...'}
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
  const bonusResponse = entry.bonusResponse
  const activities = entry.activities.map(renderActivity)
  const duration = formatToolDuration(entry.durationMs, DurationFormat.Compact)

  return (
    <div className="leon-message">
      {entry.status === FeedTurnStatus.Completed && activities.length > 0 ? (
        <ProcessGroup
          active={false}
          activeLabel="Working..."
          ariaLabel="Leon’s completed work"
          className="leon-message-work"
          completedLabel={`Worked for ${duration}`}
        >
          <div className="leon-message-activities">{activities}</div>
        </ProcessGroup>
      ) : activities}
      {entry.artifacts !== undefined && entry.artifacts.length > 0 && (
        <ArtifactAttachments artifacts={entry.artifacts} />
      )}
      {entry.finalAnswer.trim().length > 0 && (
        <FinalAnswer animationId={`${entry.id}:final-answer`}>
          {entry.finalAnswer}
        </FinalAnswer>
      )}
      {entry.finalAnswer.trim().length > 0 &&
        bonusResponse !== undefined &&
        bonusResponse.trim().length > 0 && (
        <BonusResponse animationId={`${entry.id}:bonus-response`}>
          {bonusResponse}
        </BonusResponse>
      )}
    </div>
  )
}
