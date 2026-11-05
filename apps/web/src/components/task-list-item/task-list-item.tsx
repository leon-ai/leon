import { Icon } from '@/components/icon'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'

import type { FeedPlanStep, LeonFeedActivity } from '@/data/feed'
import { isToolCallVisible } from '@/data/feed'
import { Collapse } from '@/components/collapse'
import { useProcessGroupNestedDisclosureDefault } from '@/components/process-group'
import { ToolCallList } from '@/components/tool-call-list'

import './task-list-item.sass'

interface TaskListItemProps {
  step: FeedPlanStep
  renderActivity?: ((activity: LeonFeedActivity) => ReactNode) | undefined
}

export function TaskListItem({ step, renderActivity }: TaskListItemProps) {
  const hasToolCalls = step.toolCalls.some(isToolCallVisible) || Boolean(step.activities?.length)
  const expandByDefault = useProcessGroupNestedDisclosureDefault()
  const previousStatusRef = useRef(step.status)
  const toolCallsId = useId()
  const [isExpanded, setIsExpanded] = useState(
    step.status === 'in_progress' && expandByDefault
  )

  useLayoutEffect(() => {
    if (previousStatusRef.current === step.status) {
      return
    }

    previousStatusRef.current = step.status

    // Move the disclosure with execution progress without overriding manual
    // toggles while a step remains in the same state.
    if (step.status === 'completed') {
      setIsExpanded(false)
    } else if (step.status === 'in_progress') {
      setIsExpanded(true)
    }
  }, [step.status])

  const marker = step.status === 'completed'
    ? <Icon name="check-line" className="task-list-item-marker-icon" />
    : step.status === 'error'
      ? <Icon name="close-line" className="task-list-item-marker-icon" />
      : null
  const label = (
    <>
      <span className="task-list-item-label">{step.label}</span>
      {hasToolCalls && (
        <Icon name="arrow-right-s-line" className="task-list-item-chevron" />
      )}
    </>
  )

  return (
    <li className={clsx(
      'task-list-item',
      `task-list-item-${step.status}`
    )}>
      <span className="task-list-item-marker">{marker}</span>
      <div className="task-list-item-content">
        {hasToolCalls ? (
          <button
            type="button"
            className={clsx('task-list-item-trigger', {
              'task-list-item-direct-tools': !(step.activities && renderActivity)
            })}
            aria-controls={toolCallsId}
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((isOpen) => !isOpen)}
          >
            {label}
          </button>
        ) : (
          <div className="task-list-item-heading">{label}</div>
        )}
        {hasToolCalls && (
          <Collapse
            id={toolCallsId}
            className="task-list-item-tool-calls"
            isOpen={isExpanded}
          >
            {step.activities && renderActivity ? (
              <div className="leon-message-activities activity-timeline">
                {step.activities.map(renderActivity)}
              </div>
            ) : <ToolCallList toolCalls={step.toolCalls} nested />}
          </Collapse>
        )}
      </div>
    </li>
  )
}
