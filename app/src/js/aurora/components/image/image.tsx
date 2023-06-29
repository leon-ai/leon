import type React from 'react'
import classNames from 'classnames'

import './image.sass'

interface Props {
  src: string
  width?: number | string
  height?: number | string
  shape?: 'circle' | 'square'
  borderColor?: 'white' | 'blue'
  backgroundSize?: 'cover' | 'contain'
  radiusTop?: boolean
  radiusBottom?: boolean
  overlay?: boolean
  gradient?: boolean
  gradientPosition?: 'top' | 'bottom' | 'left' | 'right'
}

export function Image({
  src,
  width,
  height,
  shape,
  borderColor,
  backgroundSize,
  radiusTop,
  radiusBottom,
  overlay,
  gradient,
  gradientPosition
}: Props) {
  return (
    <div
      className={classNames('aurora-image', {
        [`aurora-image--${shape}`]: shape,
        [`aurora-image--${borderColor}-border`]: borderColor,
        [`aurora-image--${backgroundSize}`]: backgroundSize,
        [`aurora-image--gradient-${gradientPosition}`]: gradientPosition,
        'aurora-image--radius-top': radiusTop,
        'aurora-image--radius-bottom': radiusBottom,
        'aurora-image--overlay': overlay,
        'aurora-image--gradient': gradient
      })}
      style={{
        width,
        height,
        backgroundImage: `url(${src})`
      }}
    />
  )
}
