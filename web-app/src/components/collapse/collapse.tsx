import {
  useEffect,
  useState,
  type ReactNode,
  type TransitionEvent
} from 'react'
import { clsx } from 'clsx'

import './collapse.sass'

const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

interface CollapseProps {
  children: ReactNode
  className?: string
  id?: string
  isOpen: boolean
}

/** Reveals content as one sliding block and unmounts it after closing. */
export function Collapse({
  children,
  className,
  id,
  isOpen
}: CollapseProps) {
  const [shouldRender, setShouldRender] = useState(isOpen)

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      return
    }

    if (window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches) {
      setShouldRender(false)
    }
  }, [isOpen])

  function handleTransitionEnd(event: TransitionEvent<HTMLDivElement>): void {
    if (
      event.currentTarget !== event.target ||
      event.propertyName !== 'grid-template-rows' ||
      isOpen
    ) {
      return
    }

    // Removing closed children resets any disclosures nested inside them.
    setShouldRender(false)
  }

  if (!shouldRender) {
    return null
  }

  return (
    <div
      id={id}
      className={clsx('collapse', className, {
        'collapse-open': isOpen,
        'collapse-closed': !isOpen
      })}
      aria-hidden={!isOpen}
      inert={!isOpen}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="collapse-content">
        <div className="collapse-body">{children}</div>
      </div>
    </div>
  )
}
