import { useId, type InputHTMLAttributes } from 'react'

import './controls.sass'

export interface SegmentedProps {
  label: string
  options: readonly { value: string, label: string, disabled?: boolean }[]
  value?: string
  defaultValue?: string
  name?: string
  disabled?: boolean
  onValueChange?: (value: string) => void
}

/**
 * Uses a native radio group for compact, mutually exclusive settings.
 */
export function Segmented({ label, options, value, defaultValue, name, disabled, onValueChange }: SegmentedProps) {
  const id = useId()

  return <fieldset className="aurora-segmented" disabled={disabled}>
    <legend className="aurora-control-label">{label}</legend>
    <div className="aurora-segments">
      {options.map((option) => {
        const selection: InputHTMLAttributes<HTMLInputElement> = value === undefined
          ? { defaultChecked: option.value === defaultValue } : { checked: option.value === value }

        return <label key={option.value}>
          <input {...selection} type="radio" name={name ?? id} value={option.value} disabled={option.disabled}
            onChange={() => onValueChange?.(option.value)} />
          <span>{option.label}</span>
        </label>
      })}
    </div>
  </fieldset>
}
