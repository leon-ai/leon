import type React from 'react'
import {
  TabIndicator,
  TabList as ArkTabList,
  type TabListProps
} from '@ark-ui/react'

interface Props extends Pick<TabListProps, 'children'> {}

export function TabList({ children }: Props) {
  return (
    <ArkTabList className="aurora-tab-list">
      {children}
      <TabIndicator className="aurora-tab-indicator-container">
        <div className="aurora-tab-indicator" />
      </TabIndicator>
    </ArkTabList>
  )
}
