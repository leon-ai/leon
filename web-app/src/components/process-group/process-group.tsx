import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { clsx } from 'clsx'

import { Collapse } from '../collapse'

import './process-group.sass'

interface ProcessGroupProps {
  active: boolean
  activeLabel: string
  animateWhileActive?: boolean
  ariaLabel: string
  children: ReactNode
  className?: string
  completedLabel: string
  indicator: ReactNode
}

const NestedDisclosureDefaultContext = createContext(true)

/** Returns whether nested disclosures should open on their next mount. */
export function useProcessGroupNestedDisclosureDefault(): boolean {
  return useContext(NestedDisclosureDefaultContext)
}

/** Groups one progressive agent activity behind a shared status disclosure. */
export function ProcessGroup({
  active,
  activeLabel,
  animateWhileActive = false,
  ariaLabel,
  children,
  className,
  completedLabel,
  indicator
}: ProcessGroupProps) {
  const contentId = useId()
  const previousActiveRef = useRef(active)
  const [isExpanded, setIsExpanded] = useState(active)
  const [expandNestedByDefault, setExpandNestedByDefault] = useState(active)

  useEffect(() => {
    if (previousActiveRef.current === active) {
      return
    }

    // Active work stays visible; the completed snapshot starts collapsed.
    setIsExpanded(active)
    setExpandNestedByDefault(active)
    previousActiveRef.current = active
  }, [active])

  function handleToggle(): void {
    if (isExpanded) {
      // Reopening a collapsed group should not reopen its entire disclosure tree.
      setExpandNestedByDefault(false)
    }

    setIsExpanded(!isExpanded)
  }

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
      {!decorative && (
        <i
          className="process-group-chevron ri-arrow-right-s-line"
          aria-hidden="true"
        />
      )}
    </span>
  )

  const label = active ? activeLabel : completedLabel

  return (
    <NestedDisclosureDefaultContext.Provider
      value={expandNestedByDefault}
    >
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
          onClick={handleToggle}
        >
          {active && animateWhileActive ? (
            <span className="process-group-active-content">
              {headingLayer(label)}
              {headingLayer(label, 'process-group-wave', true)}
            </span>
          ) : headingLayer(label)}
        </button>
        <Collapse
          id={contentId}
          className="process-group-content"
          isOpen={isExpanded}
        >
          {children}
        </Collapse>
      </section>
    </NestedDisclosureDefaultContext.Provider>
  )
}
