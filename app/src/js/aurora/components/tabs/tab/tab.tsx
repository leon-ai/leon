import type React from 'react'
import { TabTrigger, type TabTriggerProps } from '@ark-ui/react'

interface Props
  extends Pick<TabTriggerProps, 'children' | 'value' | 'disabled'> {}

export function Tab({ children, value, disabled }: Props) {
  return (
    <TabTrigger className="aurora-tab" value={value} disabled={disabled}>
      {children}
    </TabTrigger>
  )
}
