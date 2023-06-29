import type React from 'react'
import {
  RadioGroup as ArkRadioGroup,
  type RadioGroupProps
} from '@ark-ui/react'

import './radio-group.sass'

interface Props
  extends Pick<
    RadioGroupProps,
    'children' | 'defaultValue' | 'disabled' | 'onChange'
  > {}

export function RadioGroup({
  children,
  defaultValue,
  disabled,
  onChange
}: Props) {
  return (
    <ArkRadioGroup
      className="aurora-radio-group"
      defaultValue={defaultValue}
      disabled={disabled}
      onChange={onChange}
      orientation="horizontal"
    >
      {children}
    </ArkRadioGroup>
  )
}
