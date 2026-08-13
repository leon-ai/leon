import { useState } from 'react'
import { clsx } from 'clsx'

import type { FeedPlanStep } from '../../data/feed'
import { Loader } from '../loader'
import { useAnimateOnce } from '../streaming-text'
import { ToolCallList } from '../tool-call-list'

import './task-list-item.sass'

interface TaskListItemProps {
  step: FeedPlanStep
}

export function TaskListItem({ step }: TaskListItemProps) {
  const hasToolCalls = step.toolCalls.length > 0
  const [isExpanded, setIsExpanded] = useState(hasToolCalls)
  const shouldAnimate = useAnimateOnce(`${step.id}:plan-step`)
  const marker = step.status === 'completed'
    ? <i className="task-list-item-marker-icon ri-check-line" aria-hidden="true" />
    : step.status === 'error'
      ? <i className="task-list-item-marker-icon ri-close-line" aria-hidden="true" />
      : step.status === 'in_progress'
        ? <Loader />
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
      `task-list-item-${step.status}`,
      { 'task-list-item-animate': shouldAnimate }
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
