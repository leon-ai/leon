import type React from 'react'
import {
  TabContent as ArkTabContent,
  type TabContentProps
} from '@ark-ui/react'

interface Props extends Pick<TabContentProps, 'children' | 'value'> {}

export function TabContent({ children, value }: Props) {
  return (
    <ArkTabContent className="aurora-tab-content" value={value}>
      {children}
    </ArkTabContent>
  )
}
