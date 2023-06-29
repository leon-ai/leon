import type React from 'react'
import {
  Radio as ArkRadio,
  RadioLabel,
  RadioInput,
  RadioControl,
  type RadioProps
} from '@ark-ui/react'

interface Props extends Pick<RadioProps, 'value' | 'disabled'> {
  label: string
}

export function Radio({ label, value, disabled }: Props) {
  return (
    <ArkRadio className="aurora-radio" value={value} disabled={disabled}>
      <RadioInput />
      <RadioControl className="aurora-radio-control" />
      <RadioLabel className="aurora-radio-label">{label}</RadioLabel>
    </ArkRadio>
  )
}
