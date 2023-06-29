import React, { useState } from 'react'
import {
  Switch as ArkSwitch,
  SwitchLabel,
  SwitchInput,
  SwitchControl,
  SwitchThumb,
  type SwitchProps
} from '@ark-ui/react'

import './switch.sass'

interface Props
  extends Pick<SwitchProps, 'value' | 'checked' | 'disabled' | 'onChange'> {
  label?: string
}

export function Switch({ label, checked, value, disabled, onChange }: Props) {
  const [isChecked, setIsChecked] = useState(checked)

  return (
    <ArkSwitch
      className="aurora-switch"
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
      <>
        <SwitchInput />
        <SwitchControl className="aurora-switch-control">
          <SwitchThumb className="aurora-switch-thumb" />
        </SwitchControl>
        <SwitchLabel className="aurora-switch-label">{label}</SwitchLabel>
      </>
    </ArkSwitch>
  )
}
