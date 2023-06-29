import type React from 'react'
import classNames from 'classnames'
import { Tabs, type TabsProps } from '@ark-ui/react'

import './tab-group.sass'

interface Props
  extends Pick<TabsProps, 'children' | 'defaultValue' | 'onChange'> {
  size?: 'sm' | 'md' | 'lg'
}

export function TabGroup({ children, defaultValue, onChange, size }: Props) {
  return (
    <Tabs
      className={classNames('aurora-tab-group', {
        [`aurora-tab-group--${size}`]: size
      })}
      defaultValue={defaultValue}
      onChange={onChange}
      orientation="horizontal"
    >
      {children}
    </Tabs>
  )
}
