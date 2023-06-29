import type React from 'react'
import classNames from 'classnames'

import { Flexbox, Icon, Loader } from '..'

import './button.sass'

interface Props {
  children?: React.ReactNode
  type?: 'button' | 'submit' | 'reset'
  iconName?: string
  iconPosition?: 'left' | 'right'
  secondary?: boolean
  danger?: boolean
  light?: boolean
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
}

export function Button({
  children,
  type = 'button',
  iconName,
  iconPosition = 'left',
  secondary,
  danger,
  light,
  disabled,
  loading,
  onClick
}: Props) {
  let variant = 'primary'

  if (secondary) {
    variant = 'secondary'
  } else if (danger) {
    variant = 'danger'
  } else if (light) {
    variant = 'light'
  }

  return (
    <button
      type={type}
      className={classNames('aurora-button', {
        'aurora-button--disabled': disabled,
        'aurora-button--loading': loading,
        [`aurora-button--${variant}`]: variant
      })}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {loading ? (
        <Loader />
      ) : (
        <>
          {iconName && iconPosition === 'left' && (
            <Flexbox
              flexDirection="row"
              justifyContent="center"
              alignItems="center"
              gap="xs"
            >
              <Icon name={iconName} type="line" />
              {children}
            </Flexbox>
          )}
          {iconName && iconPosition === 'right' && (
            <Flexbox
              flexDirection="row"
              justifyContent="center"
              alignItems="center"
              gap="xs"
            >
              {children}
              <Icon name={iconName} type="line" />
            </Flexbox>
          )}
          {!iconName && children}
        </>
      )}
    </button>
  )
}
