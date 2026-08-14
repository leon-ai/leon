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

  const headingLayer = (
    label: string,
    className?: string,
    decorative = false
  ) => (
    <span
      className={clsx('process-group-heading-layer', className)}
      aria-hidden={decorative || undefined}
    >
      <span className="process-group-indicator" aria-hidden="true">
        {indicator}
      </span>
      <span className="process-group-title">{label}</span>
      <i
        className="process-group-chevron ri-arrow-right-s-line"
        aria-hidden="true"
      />
    </span>
  )

  const label = active ? activeLabel : completedLabel

  return (
    <section
      className={clsx('process-group', className, {
        'process-group-active': active
      })}
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className="process-group-trigger"
        aria-controls={contentId}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((isOpen) => !isOpen)}
      >
        {active ? (
          <span className="process-group-active-content">
            {headingLayer(label)}
            {headingLayer(label, 'process-group-wave', true)}
          </span>
        ) : headingLayer(label)}
      </button>
      {isExpanded && (
        <div id={contentId} className="process-group-content">
          {children}
        </div>
      )}
    </section>
  )
}
