import type React from 'react'
import classNames from 'classnames'

import './scroll-container.sass'

interface Props {
  children: React.ReactNode
  orientation?: 'vertical' | 'horizontal'
  width?: number | string
  height?: number | string
}

export function ScrollContainer({
  children,
  orientation = 'horizontal',
  width,
  height
}: Props) {
  return (
    <div
      className={classNames(
        'aurora-scroll-container',
        `aurora-scroll-container--${orientation}`
      )}
      style={{
        width,
        height
      }}
    >
      <div className="aurora-scroll-container-scrollview">{children}</div>
      <div className="aurora-scroll-container-mask" />
    </div>
  )
}
