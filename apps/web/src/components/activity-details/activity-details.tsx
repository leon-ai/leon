import { useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'

import { Button } from '@/components/button'

import './activity-details.sass'

/**
 * Shares the framed preview and inspector action across feed activities.
 */
export function ActivityDetails({ title, onViewDetails, notice, children }: {
  title: string
  onViewDetails: () => void
  notice?: ReactNode
  children: ReactNode
}) {
  const openedWithPointerRef = useRef(false)
  const [isPointerFocusRestored, setIsPointerFocusRestored] = useState(false)

  return (
    <div className="activity-details">
      <div className="activity-details-heading">
        <p className="activity-details-title">{title}</p>
      </div>
      {notice}
      <div className="activity-details-frame">
        {children}
        <div
          className={clsx('activity-details-footer', {
            'activity-details-pointer-focus': isPointerFocusRestored
          })}
          onClickCapture={(event) => {
            openedWithPointerRef.current = event.detail > 0
          }}
          onFocusCapture={() => {
            // Preserve the opening input method across the dialog's focus trap,
            // then let later keyboard navigation show its normal focus indicator.
            setIsPointerFocusRestored(openedWithPointerRef.current)
            openedWithPointerRef.current = false
          }}
          onBlurCapture={() => setIsPointerFocusRestored(false)}
          onKeyDownCapture={(event) => {
            if (event.key !== 'Escape') {
              setIsPointerFocusRestored(false)
            }
          }}
        >
          <Button tone="muted" onClick={onViewDetails}>View details</Button>
        </div>
      </div>
    </div>
  )
}
