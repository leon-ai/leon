import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'

import './process-group.sass'

interface ProcessGroupProps {
  active: boolean
  activeLabel: string
  ariaLabel: string
  children: ReactNode
  className?: string
  completedLabel: string
  indicator: ReactNode
}

/** Groups one progressive agent activity behind a shared status disclosure. */
export function ProcessGroup({
  active,
  activeLabel,
  ariaLabel,
  children,
  className,
  completedLabel,
  indicator
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
      {indicator}
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
      {isExpanded && (
        <div id={contentId} className="process-group-content">
          {children}
        </div>
      )}
    </section>
  )
}
