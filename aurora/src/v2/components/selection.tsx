import type { InputHTMLAttributes, Ref } from 'react'
import { SelectionControl } from './selection-control'

import './surface.sass'

export interface SelectionProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label: string
  description?: string | undefined
  multiple?: boolean
  ref?: Ref<HTMLInputElement>
}

/**
 * Retains native radio/checkbox keyboard behavior within a larger selectable row.
 */
export function Selection({ label, description, multiple = false, ...props }: SelectionProps) {
  return <label className="aurora-choice">
    <SelectionControl {...props} type={multiple ? 'checkbox' : 'radio'} />
    <span>{label}{description && <small>{description}</small>}</span>
  </label>
}
