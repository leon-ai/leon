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

import { Collapse } from '@/components/collapse'
import { ActivityWave } from '@/components/activity-wave'

import './process-group.sass'

interface ProcessGroupProps {
  active: boolean
  activeLabel: string
  animateWhileActive?: boolean
  ariaLabel: string
  children?: ReactNode
  className?: string
  completedLabel: string
  indicator?: ReactNode
  onExpandedChange?: (expanded: boolean) => void
}

const NestedDisclosureDefaultContext = createContext(true)

/**
 * Returns whether nested disclosures should open on their next mount.
 */
export function useProcessGroupNestedDisclosureDefault(): boolean {
  return useContext(NestedDisclosureDefaultContext)
}

/**
 * Shows an activity heading, with a disclosure only when details are provided.
 */
export function ProcessGroup({
  active,
  activeLabel,
  animateWhileActive = false,
  ariaLabel,
  children,
  className,
  completedLabel,
  indicator,
  onExpandedChange
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
    onExpandedChange?.(!isExpanded)
  }

  const label = active ? activeLabel : completedLabel
  const heading = (
    <ActivityWave
      active={active && animateWhileActive}
      className="process-group-heading-layer"
    >
      {indicator !== undefined && indicator !== null && (
        <span className="process-group-indicator" aria-hidden="true">
          {indicator}
        </span>
      )}
      <span className="process-group-title">{label}</span>
    </ActivityWave>
  )

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
        {children === undefined ? (
          <div className="process-group-trigger">{heading}</div>
        ) : (
          <button
            type="button"
            className="process-group-trigger"
            aria-controls={contentId}
            aria-expanded={isExpanded}
            onClick={handleToggle}
          >
            {heading}
            <i
              className="process-group-chevron ri-arrow-right-s-line"
              aria-hidden="true"
            />
          </button>
        )}
        {children !== undefined && (
          <Collapse
            id={contentId}
            className="process-group-content"
            isOpen={isExpanded}
          >
            {children}
          </Collapse>
        )}
      </section>
    </NestedDisclosureDefaultContext.Provider>
  )
}
