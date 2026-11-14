import { useId } from 'react'
import { Loader } from './loader/loader'

import './progress.sass'

export interface ProgressProps {
  label: string
  value?: number
  max?: number
}

/**
 * Shows measured progress when available and an indeterminate indicator otherwise.
 */
export function Progress({ label, value, max = 100 }: ProgressProps) {
  const id = useId()
  const maximum = Number.isFinite(max) && max > 0 ? max : 100
  const measured = value !== undefined && Number.isFinite(value)
  const current = measured ? Math.min(maximum, Math.max(0, value)) : undefined

  // Native values stay immediate; the decorative fill animates consistently across engines.
  return <div className="aurora-progress">
    <div className="aurora-progress-label">
      <span id={id}>{label}</span>
      {current === undefined ? <Loader size="sm" /> : <span>{Math.floor(current / maximum * 100)}%</span>}
    </div>
    {current !== undefined && <div className="aurora-progress-track">
      <progress aria-labelledby={id} value={current} max={maximum} />
      <span className="aurora-progress-fill" aria-hidden="true" style={{ width: `${current / maximum * 100}%` }} />
    </div>}
  </div>
}
