import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'

import './process-group.sass'

interface ProcessGroupProps {
  active: boolean
  activeIndicator: ReactNode
  activeLabel: string
  ariaLabel: string
  children: ReactNode
  className?: string
  completedIndicator: ReactNode
  completedLabel: string
}

/** Groups one progressive agent activity behind a shared status disclosure. */
export function ProcessGroup({
  active,
  activeIndicator,
  activeLabel,
  ariaLabel,
  children,
  className,
  completedIndicator,
  completedLabel
}: ProcessGroupProps) {
  const contentId = useId()
  const previousActiveRef = useRef(active)
  const [isExpanded, setIsExpanded] = useState(active)

  useEffect(() => {
    if (previousActiveRef.current === active) {
      return
    }

    // Active work stays visible; the completed snapshot starts collapsed.
    setIsExpanded(active)
    previousActiveRef.current = active
  }, [active])

  const headingContent = (
    <>
      <span className="process-group-title">
        {active ? activeLabel : completedLabel}
      </span>
    </>
  )

  return (
    <section
      className={clsx('process-group', className, {
        'process-group-active': active
      })}
      aria-label={ariaLabel}
    >
      {active ? (
        <div className="process-group-heading">
          {headingContent}
        </div>
      ) : (
        <button
          type="button"
          className="process-group-trigger"
          aria-controls={contentId}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((isOpen) => !isOpen)}
        >
          {headingContent}
          <i
            className="process-group-chevron ri-arrow-right-s-line"
            aria-hidden="true"
          />
        </button>
      )}
      <span className="process-group-indicator" aria-hidden="true">
        <span className="process-group-indicator-active">
          {activeIndicator}
        </span>
        <span className="process-group-indicator-completed">
          {completedIndicator}
        </span>
      </span>
      {isExpanded && (
        <div id={contentId} className="process-group-content">
          {children}
        </div>
      )}
    </section>
  )
}
