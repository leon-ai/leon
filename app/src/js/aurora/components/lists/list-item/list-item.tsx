import type React from 'react'
import classNames from 'classnames'

import { Icon } from '../..'

interface Props {
  children: React.ReactNode
  align?: 'left' | 'center'
  onClick?: () => void
}

export function ListItem({ children, align, onClick }: Props) {
  let isClickable = false

  if (onClick) {
    isClickable = true
  }

  return (
    <li
      className={classNames('aurora-list-item', {
        'aurora-list-item--clickable': isClickable,
        [`aurora-list-item--${align}`]: align
      })}
      onClick={isClickable ? onClick : undefined}
    >
      {isClickable ? (
        <>
          {children}
          <div className="aurora-list-item-clickable-icon">
            <Icon name="arrow-right-double" />
          </div>
        </>
      ) : (
        children
      )}
    </li>
  )
}
