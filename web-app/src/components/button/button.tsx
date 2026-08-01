import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { clsx } from 'clsx'

import { Tooltip } from '../tooltip'
import type { TooltipPosition } from '../tooltip'

import './button.sass'

type AppRouteTo = '/'
type ButtonIconType = 'line' | 'fill'
type ButtonIconPosition = 'left' | 'right'
type ButtonSize = 'sm' | 'md'
type ButtonTone = 'default' | 'muted'
export type ButtonVariant = 'ghost' | 'secondary' | 'primary' | 'danger'

interface ButtonBaseProps {
  children?: ReactNode
  className?: string
  iconName?: string
  iconType?: ButtonIconType
  iconPosition?: ButtonIconPosition
  tooltipMessage?: string
  tooltipPosition?: TooltipPosition
  ariaLabel?: string
  tone?: ButtonTone
  variant?: ButtonVariant
  size?: ButtonSize
  cursorStyle?: CSSProperties['cursor']
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
}

type ButtonProps = ButtonBaseProps & (
  | {
    to?: undefined
    href?: undefined
    type?: 'button' | 'submit'
    target?: never
    rel?: never
  }
  | {
    to: AppRouteTo
    href?: never
    type?: never
    target?: never
    rel?: never
  }
  | {
    to?: never
    href: string
    type?: never
    target?: string
    rel?: string
  }
)

export function Button({
  children,
  className,
  type = 'button',
  to,
  href,
  target,
  rel,
  iconName,
  iconType = 'line',
  iconPosition = 'left',
  tooltipMessage,
  tooltipPosition = 'bottom',
  ariaLabel,
  tone = 'default',
  variant = 'ghost',
  size = 'md',
  cursorStyle = 'pointer',
  disabled = false,
  loading = false,
  onClick
}: ButtonProps) {
  const isDisabled = disabled || loading
  const isIconOnly = children === undefined
  const accessibleLabel = ariaLabel ?? tooltipMessage
  const iconClassName = `ri-${iconName}-${iconType}`
  const buttonClassName = clsx('button', `button-${variant}`, `button-${size}`, `button-tone-${tone}`, className, {
    'button-icon-only': isIconOnly
  })
  const content = (
    <>
      {iconName && iconPosition === 'left' && (
        <i className={clsx('button-icon', iconClassName)} aria-hidden="true" />
      )}
      {children && <span className="button-label">{children}</span>}
      {iconName && iconPosition === 'right' && (
        <i className={clsx('button-icon', iconClassName)} aria-hidden="true" />
      )}
    </>
  )
  const button = to !== undefined ? (
    <Link
      to={to}
      className={buttonClassName}
      aria-label={isIconOnly ? accessibleLabel : ariaLabel}
      aria-busy={loading}
      aria-disabled={isDisabled}
      style={{ cursor: loading ? 'wait' : cursorStyle }}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (isDisabled) {
          event.preventDefault()
          return
        }

        onClick?.()
      }}
    >
      {content}
    </Link>
  ) : href === undefined ? (
    <button
      type={type}
      className={buttonClassName}
      aria-label={isIconOnly ? accessibleLabel : ariaLabel}
      aria-busy={loading}
      disabled={isDisabled}
      style={{ cursor: loading ? 'wait' : cursorStyle }}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <a
      href={href}
      className={buttonClassName}
      aria-label={isIconOnly ? accessibleLabel : ariaLabel}
      aria-busy={loading}
      aria-disabled={isDisabled}
      target={target}
      rel={rel}
      style={{ cursor: loading ? 'wait' : cursorStyle }}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (isDisabled) {
          event.preventDefault()
          return
        }

        onClick?.()
      }}
    >
      {content}
    </a>
  )

  if (tooltipMessage === undefined) {
    return button
  }

  return (
    <Tooltip message={tooltipMessage} position={tooltipPosition}>
      {button}
    </Tooltip>
  )
}
