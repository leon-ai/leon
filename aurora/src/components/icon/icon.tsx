import classNames from 'clsx'

import type { Color, Size, IconType } from '../../lib/types'
import { generateKeyId } from '../../lib/utils'

import './icon.sass'

export interface IconProps {
  iconName?: string
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  svg?: any
  // svg?: React.ReactNode
  type?: IconType
  color?: Color
  size?: Size | 'xxl'
  bgShape?: 'square' | 'circle'
  bgColor?: Color
  animated?: boolean
}

const REMIX_SIZE_MAPPING = {
  xs: 'xs',
  sm: 'sm',
  md: '1x',
  lg: 'lg',
  xl: 'xl',
  xxl: '2x'
}
const REMIX_ICON_TYPE_SUFFIXES = ['-line', '-fill']

/**
 * @see https://remixicon.com/
 */
export function Icon({
  iconName,
  svg,
  type = 'line',
  color,
  size = 'md',
  bgShape,
  bgColor,
  animated
}: IconProps) {
  let iconClassName = `ri-${iconName}`
  const hasExplicitTypeSuffix = REMIX_ICON_TYPE_SUFFIXES.some((suffix) =>
    iconName?.endsWith(suffix)
  )

  if (type && type !== 'notype' && !hasExplicitTypeSuffix) {
    iconClassName = `${iconClassName}-${type}`
  }

  return (
    <span
      key={`aurora-icon_${generateKeyId()}`}
      className={classNames('aurora-icon', {
        [`aurora-icon--${size}`]: size,
        [`aurora-icon--${bgShape}`]: bgShape,
        [`aurora-icon--bg-${bgColor}`]: bgColor,
        [`aurora-icon--${color}`]: color,
        'aurora-icon--animated': animated
      })}
    >
      {svg ? (
        svg
      ) : (
        <i
          className={classNames(iconClassName, {
            [`ri-${REMIX_SIZE_MAPPING[size]}`]: size
          })}
        />
      )}
    </span>
  )
}
