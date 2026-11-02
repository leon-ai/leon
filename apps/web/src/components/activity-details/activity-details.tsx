import type { ReactNode } from 'react'

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
  return (
    <div className="activity-details">
      <div className="activity-details-heading">
        <p className="activity-details-title">{title}</p>
        <Button iconName="expand-diagonal" tone="muted" tooltipMessage="View details"
          tooltipPosition="left" onClick={onViewDetails} />
      </div>
      {notice}
      <div className="activity-details-frame">
        {children}
      </div>
    </div>
  )
}
