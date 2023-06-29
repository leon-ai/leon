import type React from 'react'
import classNames from 'classnames'

import type { IconType } from '../../lib/types'
import { Icon, Flexbox } from '../index'

import './status.sass'

interface Props {
  children: React.ReactNode
  color?: 'blue' | 'green' | 'red' | 'yellow'
  iconName?: string
  iconType?: IconType
}

export function Status({
  children,
  color,
  iconName,
  iconType = 'line'
}: Props) {
  return (
    <div
      className={classNames('aurora-status', {
        [`aurora-status--${color}`]: color
      })}
    >
      {iconName ? (
        <Flexbox
          alignItems="center"
          justifyContent="center"
          flexDirection="row"
          gap="xs"
        >
          <Icon name={iconName} type={iconType} size="sm" />
          <i>{children}</i>
        </Flexbox>
      ) : (
        children
      )}
    </div>
  )
}
