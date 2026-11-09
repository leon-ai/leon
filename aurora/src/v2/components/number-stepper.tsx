import { useId, useRef, useState } from 'react'
import { Button } from './button/button'
import { Input } from './input/input'

import './controls.sass'

export interface NumberStepperProps {
  label: string
  name?: string
  value?: string
  defaultValue?: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onValueChange?: (value: string) => void
}

/**
 * Delegates numeric stepping, bounds and decimal precision to the native input.
 */
export function NumberStepper({ label, name, value, defaultValue = '', min, max, step = 1, disabled, onValueChange }: NumberStepperProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const id = useId()
  const [localValue, setLocalValue] = useState(defaultValue)
  const current = value ?? localValue

  function update(next: string): void {
    setLocalValue(next)
    onValueChange?.(next)
  }

  function advance(direction: number): void {
    const input = inputRef.current
    if (!(input instanceof HTMLInputElement)) {
      return
    }

    input.stepUp(direction)
    update(input.value)
  }

  return <div className="aurora-field">
    <label htmlFor={id}>{label}</label>
    <span className="aurora-number-stepper">
      <Button ariaLabel={`Decrease ${label}`} disabled={disabled || current !== '' && min !== undefined && Number(current) <= min}
        variant="secondary" onClick={() => advance(-1)}>−</Button>
      <Input id={id} ariaLabel={label} type="number" name={name} value={current} min={min} max={max} step={step}
        disabled={disabled} fieldRef={inputRef} onChange={(event) => update(event.target.value)} />
      <Button ariaLabel={`Increase ${label}`} disabled={disabled || current !== '' && max !== undefined && Number(current) >= max}
        variant="secondary" onClick={() => advance(1)}>+</Button>
    </span>
  </div>
}
