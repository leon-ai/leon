import { clsx } from 'clsx'

import './status.sass'

export type StatusVariant = 'primary' | 'secondary' | 'success' | 'error' | 'warning'

export interface StatusProps {
  label: string
  variant?: StatusVariant
}

/**
 * Distinguishes passive statuses from actions using shared colors and a status dot.
 */
export function Status({ label, variant = 'primary' }: StatusProps) {
  return <span className={clsx('status', `status-${variant}`)}>
    {variant !== 'secondary' && <span className="status-dot" aria-hidden="true" />}
    {label}
  </span>
}
