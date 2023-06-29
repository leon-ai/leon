import type React from 'react'
import classNames from 'classnames'

import { Text } from '../..'

interface Props {
  children: React.ReactNode
  align?: 'left' | 'center'
}

export function ListHeader({ children, align }: Props) {
  return (
    <div
      className={classNames('aurora-list-header', {
        [`aurora-list-header--${align}`]: align
      })}
    >
      <Text fontWeight="semi-bold">{children}</Text>
    </div>
  )
}
