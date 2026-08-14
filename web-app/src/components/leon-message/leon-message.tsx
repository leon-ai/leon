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
            activeIndicator={(
              <DottedIcon
                active={planIsActive}
                ariaLabel="Leon is executing a plan"
                source={mapIconSource}
                sourceHeight={24}
                sourceWidth={24}
              />
            )}
            activeLabel="Executing plan..."
            ariaLabel="Leon’s execution plan"
            completedIndicator={(
              <i className="ri-map-2-line" />
            )}
            completedLabel="Completed plan"
          >
            <TaskList steps={plan} />
          </ProcessGroup>
        ) : toolCount > 0 ? (
          <ProcessGroup
            active={toolsAreActive}
            activeIndicator={(
              <DottedIcon
                active={toolsAreActive}
                ariaLabel="Leon is using tools"
                source={toolsIconSource}
                sourceHeight={24}
                sourceWidth={24}
              />
            )}
            activeLabel="Using tools..."
            ariaLabel="Leon’s tool usage"
            completedIndicator={(
              <i className="ri-tools-line" />
            )}
            completedLabel={`Used ${toolCount} ${
              toolCount === 1 ? 'tool' : 'tools'
            }`}
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
