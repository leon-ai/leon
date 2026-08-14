import { useLayoutEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'

import type { FeedPlanStep } from '../../data/feed'
import { useProcessGroupNestedDisclosureDefault } from '../process-group'
import { ToolCallList } from '../tool-call-list'

import './task-list-item.sass'

interface TaskListItemProps {
  step: FeedPlanStep
}

export function TaskListItem({ step }: TaskListItemProps) {
  const hasToolCalls = step.toolCalls.length > 0
  const expandByDefault = useProcessGroupNestedDisclosureDefault()
  const previousStatusRef = useRef(step.status)
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
    ? <i className="task-list-item-marker-icon ri-check-line" aria-hidden="true" />
    : step.status === 'error'
      ? <i className="task-list-item-marker-icon ri-close-line" aria-hidden="true" />
      : null
  const label = (
    <>
      <span className="task-list-item-label">{step.label}</span>
      {hasToolCalls && (
        <i
          className="task-list-item-chevron ri-arrow-right-s-line"
          aria-hidden="true"
        />
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
            className="task-list-item-trigger"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((isOpen) => !isOpen)}
          >
            {label}
          </button>
        ) : (
          <div className="task-list-item-heading">{label}</div>
        )}
        {hasToolCalls && isExpanded && (
          <ToolCallList toolCalls={step.toolCalls} nested />
        )}
      </div>
    </li>
  )
}
