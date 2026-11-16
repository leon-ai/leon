import type { ReactNode } from 'react'
import { clsx } from 'clsx'

import './callout.sass'

export type CalloutVariant = 'info' | 'warning' | 'danger'

export interface CalloutProps {
  children: ReactNode
  icon: ReactNode
  variant?: CalloutVariant
  className?: string
}

/**
 * Gives contextual guidance a shared surface while leaving icon artwork to the host.
 */
export function Callout({ children, icon, variant = 'info', className }: CalloutProps) {
  return <aside className={clsx('callout', `callout-${variant}`, className)}>
    <span className="callout-icon" aria-hidden="true">{icon}</span>
    <div className="callout-content">{children}</div>
  </aside>
}
