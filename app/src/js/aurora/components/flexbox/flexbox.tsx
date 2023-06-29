import type React from 'react'
import classNames from 'classnames'

import { type Size } from '../../lib/types'

import './flexbox.sass'

interface Props {
  children: React.ReactNode
  fullWidth?: boolean
  display?: 'flex' | 'inline-flex'
  alignItems?: 'center' | 'flex-start' | 'flex-end' | 'baseline' | 'stretch'
  justifyContent?:
    | 'center'
    | 'flex-start'
    | 'flex-end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
    | 'stretch'
  flexDirection?: 'row' | 'row-reverse' | 'column' | 'column-reverse'
  gap?: Size
  rowGap?: Size
  columnGap?: Size
  padding?: boolean
  paddingX?: boolean
  paddingY?: boolean
}

export function Flexbox({
  children,
  fullWidth,
  display,
  alignItems,
  justifyContent,
  flexDirection,
  gap,
  rowGap,
  columnGap,
  padding,
  paddingX,
  paddingY
}: Props) {
  return (
    <div
      className={classNames('aurora-flexbox', {
        'aurora-flexbox--full-width': fullWidth,
        'aurora-flexbox--padding': padding,
        'aurora-flexbox--padding-x': paddingX,
        'aurora-flexbox--padding-y': paddingY,
        [`aurora-flexbox--${display}`]: display,
        [`aurora-flexbox--align-${alignItems}`]: alignItems,
        [`aurora-flexbox--justify-${justifyContent}`]: justifyContent,
        [`aurora-flexbox--${flexDirection}`]: flexDirection,
        [`aurora-flexbox--gap-${gap}`]: gap,
        [`aurora-flexbox--row-gap-${rowGap}`]: rowGap,
        [`aurora-flexbox--column-gap-${columnGap}`]: columnGap
      })}
    >
      {children}
    </div>
  )
}
