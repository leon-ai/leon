import { clsx } from 'clsx'
import mapIconSource from 'remixicon/icons/Map/map-2-line.svg?url'
import toolsIconSource from 'remixicon/icons/Design/tools-line.svg?url'

import type { LeonFeedEntry } from '../../data/feed'
import { DottedIcon } from '../dotted-icon'
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

export function LeonMessage({ entry }: LeonMessageProps) {
  const shouldAnimateExecution = useAnimateOnce(`${entry.id}:execution`)
  const plan = entry.plan
  const toolCalls = entry.toolCalls ?? []
  const planIsActive = plan?.some((step) =>
    step.status === 'in_progress' || step.status === 'pending'
  ) ?? false
  const toolsAreActive = toolCalls.some((toolCall) =>
    toolCall.status === 'running'
  )
  const toolCount = toolCalls.length

  return (
    <div className="leon-message">
      <ThinkingMessage
        animationId={`${entry.id}:thinking`}
        details={entry.thinking.details}
        durationMs={entry.thinking.durationMs}
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
        {plan !== undefined ? (
          <ProcessGroup
            active={planIsActive}
            activeLabel="Executing plan..."
            ariaLabel="Leon’s execution plan"
            completedLabel="Completed plan"
            indicator={(
              <DottedIcon
                active={planIsActive}
                ariaLabel={planIsActive
                  ? 'Leon is executing a plan'
                  : 'Leon completed the plan'}
                source={mapIconSource}
                sourceHeight={24}
                sourceWidth={24}
              />
            )}
          >
            <TaskList steps={plan} />
          </ProcessGroup>
        ) : toolCount > 0 ? (
          <ProcessGroup
            active={toolsAreActive}
            activeLabel="Using tools..."
            ariaLabel="Leon’s tool usage"
            completedLabel={`Used ${toolCount} ${
              toolCount === 1 ? 'tool' : 'tools'
            }`}
            indicator={(
              <DottedIcon
                active={toolsAreActive}
                ariaLabel={toolsAreActive
                  ? 'Leon is using tools'
                  : `Leon used ${toolCount} ${
                    toolCount === 1 ? 'tool' : 'tools'
                  }`}
                source={toolsIconSource}
                sourceHeight={24}
                sourceWidth={24}
              />
            )}
          >
            <ToolCallList toolCalls={toolCalls} />
          </ProcessGroup>
        ) : null}
      </div>
      {entry.finalAnswer.trim().length > 0 && (
        <FinalAnswer animationId={`${entry.id}:final-answer`}>
          {entry.finalAnswer}
        </FinalAnswer>
      )}
    </div>
  )
}
