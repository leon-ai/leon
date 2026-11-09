import type { SelectionProps } from './selection'
import { SelectionControl } from './selection-control'

import './surface.sass'

/**
 * Provides an on/off control with native keyboard and form semantics.
 */
export function Switch({ label, description, ...props }: Omit<SelectionProps, 'multiple'>) {
  return <label className="aurora-choice">
    <SelectionControl {...props} type="checkbox" role="switch" />
    <span>{label}{description && <small>{description}</small>}</span>
  </label>
}
