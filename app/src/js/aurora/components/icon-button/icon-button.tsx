import React, { useState } from 'react'
import classNames from 'classnames'

import { Icon, Loader } from '..'
import { type Props as IconProps } from '../icon'

import './icon-button.sass'

interface Props {
  name: string
  type?: 'button' | 'submit' | 'reset'
  iconType?: IconProps['type']
  size?: IconProps['size']
  shape?: IconProps['bgShape']
  activated?: boolean
  secondary?: boolean
  danger?: boolean
  light?: boolean
  disabled?: boolean
  loading?: boolean
  onClick?: (isActivated: boolean) => void
}

export function IconButton({
  name,
  type = 'button',
  iconType = 'line',
  size,
  shape,
  activated,
  secondary,
  danger,
  light,
  disabled,
  loading,
  onClick
}: Props) {
  const [isActivated, setIsActivated] = useState(activated || false)

  let variant = 'primary'

  if (danger) {
    variant = 'danger'
  }

  return (
    <button
      type={type}
      className={classNames('aurora-icon-button aurora-button', {
        'aurora-button--secondary': secondary,
        'aurora-button--light': light,
        'aurora-button--disabled': disabled,
        'aurora-button--loading': loading,
        'aurora-icon-button--activated': isActivated,
        [`aurora-button--${variant}`]: variant,
        [`aurora-icon-button--${size}`]: size,
        [`aurora-icon-button--${shape}`]: shape
      })}
      disabled={disabled || loading}
      onClick={() => {
        if (onClick) {
          if (typeof activated === 'undefined') {
            onClick(false)
          } else {
            const newActivatedState = !isActivated

            setIsActivated(newActivatedState)
            onClick(newActivatedState)
          }
        }
      }}
    >
      {loading ? (
        <Loader />
      ) : (
        <>
          <Icon type={iconType} name={name} size={size} />
        </>
      )}
    </button>
  )
}
