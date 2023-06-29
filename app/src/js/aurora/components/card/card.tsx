import type React from 'react'
import classNames from 'classnames'

import './card.sass'

interface Props {
  children: React.ReactNode
  fullWidth?: boolean
}

export function Card({ children, fullWidth }: Props) {
  return (
    <div
      className={classNames('aurora-card', {
        'aurora-card--full-width': fullWidth
      })}
    >
      {children}
    </div>
  )
}
