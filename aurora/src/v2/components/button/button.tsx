import type { AnchorHTMLAttributes, AriaAttributes, CSSProperties, MouseEvent, ReactNode } from 'react'
import { clsx } from 'clsx'
import { BUTTON_VARIANTS, BUTTON_SIZES } from '../../contracts/controls'
import { Loader } from '../loader/loader'

import './button.sass'

export type ButtonVariant = typeof BUTTON_VARIANTS[number]

export interface ButtonProps {
  children?: ReactNode
  className?: string
  icon?: ReactNode
  iconPosition?: 'left' | 'right'
  ariaLabel?: string
  ariaPressed?: boolean
  ariaBusy?: boolean
  ariaExpanded?: boolean
  ariaControls?: string | undefined
  ariaHasPopup?: AriaAttributes['aria-haspopup']
  tone?: 'default' | 'muted'
  variant?: ButtonVariant
  size?: typeof BUTTON_SIZES[number]
  cursorStyle?: CSSProperties['cursor']
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit' | undefined
  form?: string
  href?: string | undefined
  target?: string | undefined
  rel?: string | undefined
  onClick?: () => void
  renderLink?: (props: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target'>) => ReactNode
}

/**
 * Keeps DOM-based controls and React controls on the same variants and geometry.
 */
export function getButtonClassName({ variant = 'ghost', size = 'md', tone = 'default', className, iconOnly = false }: {
  variant?: ButtonVariant
  size?: ButtonProps['size']
  tone?: ButtonProps['tone']
  className?: string
  iconOnly?: boolean
}): string {
  return clsx('button', `button-${variant}`, `button-${size}`, `button-tone-${tone}`, className, {
    'button-icon-only': iconOnly
  })
}

/**
 * Shares control geometry and interaction states while leaving routing to the host.
 */
export function Button({
  children, className, icon, iconPosition = 'left', ariaLabel, ariaPressed,
  ariaBusy, ariaExpanded, ariaControls, ariaHasPopup, tone = 'default',
  variant = 'ghost', size = 'md', cursorStyle = 'pointer', disabled = false,
  loading = false, type = 'button', form, href, target, rel, onClick, renderLink
}: ButtonProps) {
  const isDisabled = disabled || loading
  const isIconOnly = children === undefined
  const common = {
    className: getButtonClassName({ variant, size, tone, iconOnly: isIconOnly, ...(className ? { className } : {}) }),
    'aria-label': ariaLabel,
    'aria-pressed': ariaPressed,
    'aria-busy': ariaBusy ?? loading,
    'aria-expanded': ariaExpanded,
    'aria-controls': ariaControls,
    'aria-haspopup': ariaHasPopup,
    style: { cursor: loading ? 'wait' : cursorStyle }
  }
  const iconContent = (loading || icon !== undefined) && <span className="button-icon" aria-hidden="true">
    {loading ? <Loader size="sm" /> : icon}
  </span>
  const content = <>
    {(loading || iconPosition === 'left') && iconContent}
    {children && <span className="button-label">{children}</span>}
    {!loading && iconPosition === 'right' && iconContent}
  </>

  if (href !== undefined || renderLink !== undefined) {
    const props: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target'> = {
      ...common, rel, children: content, 'aria-disabled': isDisabled,
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        if (isDisabled) {
          event.preventDefault()
          return
        }

        onClick?.()
      }
    }

    return renderLink ? renderLink(props) : <a {...props} href={href} target={target} />
  }

  return <button {...common} type={type} form={form} disabled={isDisabled} onClick={onClick}>{content}</button>
}
