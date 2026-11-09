import type { ReactNode } from 'react'
import { Tabs as ArkTabs } from '@ark-ui/react/tabs'

import './controls.sass'

export interface TabsProps {
  label: string
  items: readonly { value: string, label: string, content: ReactNode, disabled?: boolean }[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

/**
 * Shares the installed accessible tab behavior with lazily mounted panels.
 */
export function Tabs({ label, items, value, defaultValue, onValueChange }: TabsProps) {
  return <ArkTabs.Root className="aurora-tabs" value={value} defaultValue={defaultValue ?? items[0]?.value}
    lazyMount unmountOnExit onValueChange={(details) => onValueChange?.(details.value)}>
    <ArkTabs.List aria-label={label} className="aurora-tab-list">
      {items.map((item) => <ArkTabs.Trigger key={item.value} value={item.value} disabled={item.disabled}>
        {item.label}
      </ArkTabs.Trigger>)}
    </ArkTabs.List>
    {items.map((item) => <ArkTabs.Content key={item.value} value={item.value}>{item.content}</ArkTabs.Content>)}
  </ArkTabs.Root>
}
