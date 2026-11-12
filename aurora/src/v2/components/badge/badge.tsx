import { clsx } from 'clsx'

import './badge.sass'

export type BadgeVariant = 'primary' | 'secondary' | 'success' | 'error' | 'warning'

export interface BadgeProps {
  label: string
  variant?: BadgeVariant
}

/**
 * Distinguishes passive statuses from actions using shared colors and a status dot.
 */
export function Badge({ label, variant = 'primary' }: BadgeProps) {
  return <span className={clsx('badge', `badge-${variant}`)}>
    {variant !== 'secondary' && <span className="badge-dot" aria-hidden="true" />}
    {label}
  </span>
}
