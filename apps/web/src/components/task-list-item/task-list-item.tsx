import { Icon } from '@/components/icon'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'

import type { FeedPlanStep, LeonFeedActivity } from '@/data/feed'
import { hasActiveStepPreparation, isToolCallVisible } from '@/data/feed'
import { Collapse } from '@/components/collapse'
import { Loader } from '@/components/loader'
import { useProcessGroupNestedDisclosureDefault } from '@/components/process-group'
import { ToolCallList } from '@/components/tool-call-list'
import { useActivityNodeEntrance } from '@/hooks/use-activity-node-entrance'

import './task-list-item.sass'

interface TaskListItemProps {
  animationId: string
  step: FeedPlanStep
  renderActivity?: ((activity: LeonFeedActivity) => ReactNode) | undefined
}

export function TaskListItem({ animationId, step, renderActivity }: TaskListItemProps) {
  const shouldAnimate = useActivityNodeEntrance(animationId)
  const hasToolCalls = step.toolCalls.some(isToolCallVisible) || Boolean(step.activities?.length)
  const expandByDefault = useProcessGroupNestedDisclosureDefault()
  const preparationActive = hasActiveStepPreparation(step)
  const previousState = useRef({ status: step.status, preparationActive })
  const toolCallsId = useId()
  const [isExpanded, setIsExpanded] = useState(
    preparationActive || step.status === 'in_progress' && expandByDefault
  )
  const [revealOnOpen, setRevealOnOpen] = useState(false)

  useLayoutEffect(() => {
    const previous = previousState.current
    if (previous.status === step.status && previous.preparationActive === preparationActive) {
      return
    }

    previousState.current = { status: step.status, preparationActive }

    // A step can finish before its retained preparation. Keep the same
    // disclosure state until that work settles or the owner toggles it.
    if (preparationActive) {
      if (!previous.preparationActive) {
        setIsExpanded(true)
        setRevealOnOpen(false)
      }
    } else if (step.status === 'in_progress') {
      setIsExpanded(true)
      setRevealOnOpen(false)
    } else if (step.status === 'completed' || previous.preparationActive) {
      setIsExpanded(false)
      setRevealOnOpen(false)
    }
  }, [preparationActive, step.status])

  const marker = step.status === 'completed'
    ? <Icon name="check-line" className="task-list-item-marker-icon" />
    : step.status === 'error'
      ? <Icon name="close-line" className="task-list-item-marker-icon" />
      : step.status === 'in_progress'
        ? <Loader size="xs" />
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
      `task-list-item-${step.status}`,
      { 'activity-node-enter': shouldAnimate }
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
            onClick={() => {
              setRevealOnOpen(!isExpanded)
              setIsExpanded(!isExpanded)
            }}
          >
            {label}
          </button>
        ) : (
          <div className="task-list-item-heading">{label}</div>
        )}
        {hasToolCalls && (
          <Collapse
            id={toolCallsId}
            className={clsx('task-list-item-tool-calls', {
              'activity-disclosure-reveal': revealOnOpen
            })}
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
