import { clsx } from 'clsx'

import './loader.sass'

interface LoaderProps {
  size?: 'sm' | 'md'
  label?: string
}

/**
 * Shares loading motion and optional status text across inline and page states.
 * Unlabelled indicators are decorative beside an existing accessible status.
 */
export function Loader({ size = 'md', label }: LoaderProps) {
  return (
    <span className={clsx('loader', `loader-${size}`)} role={label ? 'status' : undefined}>
      <span className="loader-indicator" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  )
}
