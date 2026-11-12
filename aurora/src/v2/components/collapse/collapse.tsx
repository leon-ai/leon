import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { useExitCleanup } from '../../hooks/use-exit-cleanup'

import './collapse.sass'

export interface CollapseProps {
  children: ReactNode
  className?: string
  id?: string
  isOpen: boolean
}

/**
 * Reveals content as one sliding block, retaining the last committed children
 * only until closing finishes. Exiting controls cannot receive focus or input.
 */
export function Collapse({ children, className, id, isOpen }: CollapseProps) {
  const elementRef = useRef<HTMLDivElement>(null)
  const lastChildren = useRef<ReactNode>(null)
  const [shouldRender, setShouldRender] = useState(isOpen)

  useLayoutEffect(() => {
    if (isOpen) {
      lastChildren.current = children
      setShouldRender(true)
    }
  }, [isOpen, children])

  // CSS owns the timing. Missing or cancelled transitions must still release
  // retained content, while reopening cancels an obsolete exit cleanup.
  useExitCleanup(elementRef, shouldRender && !isOpen, () => {
    lastChildren.current = null
    setShouldRender(false)
  })

  if (!isOpen && !shouldRender) {
    return null
  }

  return <div ref={elementRef} id={id}
    className={clsx('collapse', className, {
      'collapse-open': isOpen,
      'collapse-closed': !isOpen
    })}
    aria-hidden={!isOpen} inert={!isOpen}>
    <div className="collapse-content">
      <div className="collapse-body">{isOpen ? children : lastChildren.current}</div>
    </div>
  </div>
}
