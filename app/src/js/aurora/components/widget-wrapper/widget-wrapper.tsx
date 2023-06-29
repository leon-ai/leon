import type React from 'react'
import classNames from 'classnames'

import './widget-wrapper.sass'

interface Props {
  children: React.ReactNode
  noPadding?: boolean
  paddingTop?: boolean
  paddingBottom?: boolean
  paddingLeft?: boolean
  paddingRight?: boolean
}

export function WidgetWrapper({
  children,
  noPadding,
  paddingTop,
  paddingBottom,
  paddingLeft,
  paddingRight
}: Props) {
  return (
    <div
      className={classNames('aurora-widget-wrapper', {
        'aurora-widget-wrapper--no-padding': noPadding,
        'aurora-widget-wrapper--padding-top': paddingTop,
        'aurora-widget-wrapper--padding-bottom': paddingBottom,
        'aurora-widget-wrapper--padding-left': paddingLeft,
        'aurora-widget-wrapper--padding-right': paddingRight
      })}
    >
      {children}
    </div>
  )
}
