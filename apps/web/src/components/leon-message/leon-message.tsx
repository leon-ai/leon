import { clsx } from 'clsx'
import { memo } from 'react'

import type {
  FeedPlanActivity,
  FeedToolCall,
  FeedToolsActivity,
  LeonFeedActivity,
  LeonFeedEntry
} from '@/data/feed'
import { FeedTurnStatus, isToolCallVisible } from '@/data/feed'
import { DurationFormat, formatToolDuration } from '@/utils/format-tool-duration'
import { ArtifactAttachments } from '@/components/artifact-attachments'
import { BonusResponse } from '@/components/bonus-response'
import { FinalAnswer } from '@/components/final-answer'
import { ProcessGroup } from '@/components/process-group'
import { StreamingText, useAnimateOnce } from '@/components/streaming-text'
import { TaskList } from '@/components/task-list'
import { ThinkingMessage } from '@/components/thinking-message'
import { ToolCallList } from '@/components/tool-call-list'
import { WorkingMessage } from '@/components/working-message'

import './leon-message.sass'

interface LeonMessageProps {
  entry: LeonFeedEntry
}

interface ExecutionActivityProps {
  activity: FeedPlanActivity | FeedToolsActivity
}

/**
 * Sums recorded execution time without including gaps between tool calls.
 * This is cumulative work, not wall-clock time when calls run concurrently.
 * Incomplete timing cannot reliably describe the whole group.
 */
function getToolGroupDuration(toolCalls: FeedToolCall[]): number | undefined {
  let duration = 0

  for (const call of toolCalls) {
    if (
      call.durationMs === undefined || !Number.isFinite(call.durationMs) || call.durationMs < 0
    ) {
      return undefined
    }

    duration += call.durationMs
  }

  return toolCalls.length > 0 && Number.isFinite(duration) ? duration : undefined
}

function ExecutionActivity({ activity }: ExecutionActivityProps) {
  const shouldAnimate = useAnimateOnce(`${activity.id}:execution`)

  if (activity.type === 'plan') {
    const planDuration = formatToolDuration(activity.durationMs, DurationFormat.Compact)
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
          completedLabel={(activity.complete ?? activity.steps.every((step) => step.status === 'completed'))
            ? `Completed plan${planDuration ? ` for ${planDuration}` : ''}` : 'Execution plan'}
          indicator={<i className="ri-map-2-line" aria-hidden="true" />}
        >
          <TaskList steps={activity.steps} renderActivity={renderActivity} />
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
  const hasVisibleToolCalls = activity.toolCalls.some(isToolCallVisible)
  const toolCount = activity.toolCalls.length
  const duration = formatToolDuration(getToolGroupDuration(activity.toolCalls), DurationFormat.Compact)

  return (
    <div className={clsx('leon-message-execution', {
      'leon-message-execution-animate': shouldAnimate
    })}>
      <ProcessGroup
        active={toolsAreActive}
        animateWhileActive={!hasVisibleToolCalls}
        activeLabel={toolsAreRunning ? 'Using tools...' : 'Preparing tool calls...'}
        ariaLabel="Leon’s tool usage"
        completedLabel={`Used ${toolCount} ${
          toolCount === 1 ? 'tool' : 'tools'
        }${duration ? ` for ${duration}` : ''}`}
        indicator={(
          <i className="ri-pencil-ruler-2-line" aria-hidden="true" />
        )}
      >
        {hasVisibleToolCalls ? <ToolCallList toolCalls={activity.toolCalls} /> : undefined}
      </ProcessGroup>
    </div>
  )
}

function renderActivity(activity: LeonFeedActivity) {
  if (activity.type === 'working') {
    return (
      <WorkingMessage
        key={activity.id}
        phaseId={activity.id}
        {...(activity.label === undefined ? {} : { label: activity.label })}
      />
    )
  }

  if (activity.type === 'processing') {
    const currentRequest = activity.requests?.findLast((request) => request.isActive)
    if (currentRequest) {
      return (
        <WorkingMessage
          key={activity.id}
          phaseId={activity.id}
          label={currentRequest.activeLabel ?? 'Processing...'}
          iconName={currentRequest.iconName}
        />
      )
    }

    const request = activity.inline ? activity.requests?.[0] : undefined
    if (request) {
      return (
        <ProcessGroup
          key={activity.id}
          active={false}
          activeLabel="Processing..."
          ariaLabel="Leon’s inference"
          completedLabel={`${request.label} ${formatToolDuration(request.durationMs, DurationFormat.Precise)}`}
          indicator={<i className={`ri-${request.iconName}`} aria-hidden="true" />}
        />
      )
    }

    return (
      <ProcessGroup
        key={activity.id}
        active={false}
        activeLabel="Processing..."
        ariaLabel="Leon’s processing"
        completedLabel={`Processed for ${formatToolDuration(activity.durationMs, DurationFormat.Compact)}`}
        indicator={<i className="ri-cpu-line" aria-hidden="true" />}
      >
        {activity.requests?.length ? (
          <div className="leon-message-activities">
            {activity.requests.map((request) => (
              <ProcessGroup
                key={request.id}
                active={false}
                activeLabel="Processing..."
                ariaLabel="Leon’s inference"
                completedLabel={`${request.label} ${formatToolDuration(request.durationMs, DurationFormat.Precise)}`}
                indicator={<i className={`ri-${request.iconName}`} aria-hidden="true" />}
              />
            ))}
          </div>
        ) : undefined}
      </ProcessGroup>
    )
  }
  if (activity.type === 'other') {
    return (
      <ProcessGroup
        key={activity.id}
        active={false}
        activeLabel="Processing..."
        ariaLabel="Leon’s other processing"
        completedLabel={`Other processing for ${formatToolDuration(activity.durationMs, DurationFormat.Compact)}`}
        indicator={<i className="ri-more-line" aria-hidden="true" />}
      />
    )
  }

  if (activity.type === 'retry') {
    return (
      <ProcessGroup
        key={activity.id}
        active={false}
        activeLabel="Retrying..."
        ariaLabel="Leon’s retries"
        completedLabel={`Retried ${activity.count} ${activity.count === 1 ? 'time' : 'times'}`}
        indicator={<i className="ri-refresh-line" aria-hidden="true" />}
      />
    )
  }

  if (activity.type === 'review' || activity.type === 'answer') {
    const isReview = activity.type === 'review'
    const duration = formatToolDuration(activity.durationMs, DurationFormat.Compact)

    return (
      <ProcessGroup
        key={activity.id}
        active={false}
        activeLabel={isReview ? 'Reviewing...' : 'Generating answer...'}
        ariaLabel={isReview ? 'Leon’s review' : 'Leon’s answer generation'}
        completedLabel={isReview ? `Reviewed for ${duration}` : `Generated answer in ${duration}`}
        indicator={<i className={isReview ? 'ri-search-eye-line' : 'ri-pencil-ai-line'} aria-hidden="true" />}
      />
    )
  }

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

export const LeonMessage = memo(function LeonMessage({ entry }: LeonMessageProps) {
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
        <FinalAnswer animationId={`${entry.id}:${entry.answerGenerationId ?? 'accepted'}:final-answer`}>
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
})
