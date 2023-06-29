import React, { useState } from 'react'
import {
  Checkbox as ArkCheckbox,
  CheckboxLabel,
  CheckboxInput,
  CheckboxControl,
  type CheckboxProps
} from '@ark-ui/react'

import { Icon } from '../icon'

import './checkbox.sass'

interface Props
  extends Pick<CheckboxProps, 'value' | 'checked' | 'disabled' | 'onChange'> {
  label?: string
}

export function Checkbox({ label, checked, value, disabled, onChange }: Props) {
  const [isChecked, setIsChecked] = useState(checked)

  return (
    <ArkCheckbox
      className="aurora-checkbox"
      value={value}
      checked={isChecked}
      disabled={disabled}
      onChange={(e) => {
        setIsChecked(e.checked)

        if (onChange) {
          onChange(e)
        }
      }}
    >
      {(state) => (
        <>
          <CheckboxInput />
          <CheckboxControl className="aurora-checkbox-control">
            {state.isChecked ? (
              <Icon name="check" size="sm" animated />
            ) : (
              <div className="aurora-checkbox-placeholder" />
            )}
          </CheckboxControl>
          <CheckboxLabel className="aurora-checkbox-label">
            {label}
          </CheckboxLabel>
        </>
      )}
    </ArkCheckbox>
  )
}
