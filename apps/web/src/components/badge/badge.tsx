import { clsx } from 'clsx'

import './badge.sass'

interface BadgeProps {
  label: string
  variant?: 'primary' | 'secondary'
}

export function Badge({
  label,
  variant = 'primary'
}: BadgeProps) {
  return (
    <div className={clsx('badge', `badge-${variant}`)}>
      {variant === 'primary' && <span className="badge-dot" aria-hidden="true" />}
      {label}
    </div>
  )
}
