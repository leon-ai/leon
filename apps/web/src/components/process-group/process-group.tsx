import { Icon } from '@/components/icon'
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
import { ActivityTimestamp, forwardTimestampClickToDisclosure } from '@/components/activity-timestamp'
import { useActivityNodeEntrance } from '@/hooks/use-activity-node-entrance'

import './process-group.sass'

interface ProcessGroupProps {
  active: boolean
  activeLabel: string
  animationId: string
  animateWhileActive?: boolean
  ariaLabel: string
  children?: ReactNode
  className?: string
  completedLabel: string
  defaultExpanded?: boolean
  indicator?: ReactNode
  onExpandedChange?: (expanded: boolean) => void
  startedAt?: number | undefined
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
  animationId,
  animateWhileActive = false,
  ariaLabel,
  children,
  className,
  completedLabel,
  defaultExpanded = active,
  indicator,
  onExpandedChange,
  startedAt
}: ProcessGroupProps) {
  const contentId = useId()
  const shouldAnimate = useActivityNodeEntrance(animationId)
  const previousDefaultExpanded = useRef(defaultExpanded)
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [revealOnOpen, setRevealOnOpen] = useState(false)
  const [expandNestedByDefault, setExpandNestedByDefault] = useState(defaultExpanded)

  useEffect(() => {
    if (previousDefaultExpanded.current === defaultExpanded) {
      return
    }

    // Ongoing child work can keep the group open under its completed heading.
    setIsExpanded(defaultExpanded)
    setRevealOnOpen(false)
    setExpandNestedByDefault(defaultExpanded)
    previousDefaultExpanded.current = defaultExpanded
  }, [defaultExpanded])

  function handleToggle(): void {
    if (isExpanded) {
      // Reopening a collapsed group should not reopen its entire disclosure tree.
      setExpandNestedByDefault(false)
    }

    setRevealOnOpen(!isExpanded)
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
          'process-group-active': active,
          'activity-node-enter': shouldAnimate
        })}
        aria-label={ariaLabel}
      >
        <div className="process-group-heading" onClick={forwardTimestampClickToDisclosure}>
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
              <Icon name="arrow-right-s-line" className="process-group-chevron" />
            </button>
          )}
          <ActivityTimestamp timestamp={startedAt} />
        </div>
        {children !== undefined && (
          <Collapse
            id={contentId}
            className={clsx('process-group-content', {
              'activity-disclosure-reveal': revealOnOpen
            })}
            isOpen={isExpanded}
          >
            {children}
          </Collapse>
        )}
      </section>
    </NestedDisclosureDefaultContext.Provider>
  )
}
