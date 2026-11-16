import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { clsx } from 'clsx'

import { Icon } from '@/components/icon'

import './dropdown.sass'

export type DropdownItemVariant = 'default' | 'danger'

export interface DropdownItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode
  trailing?: ReactNode
  selected?: boolean
  showSelection?: boolean
  variant?: DropdownItemVariant
}

/**
 * Shares dropdown row spacing and a trailing selection marker while preserving
 * the caller's semantic role, keyboard behavior and optional accessory icons.
 */
export function DropdownItem({
  children, className, icon, trailing, selected, showSelection = true,
  variant = 'default', role = 'menuitem', type = 'button', ...props
}: DropdownItemProps) {
  return <button
    aria-selected={role === 'option' ? selected : undefined}
    aria-checked={role === 'radio' || role === 'menuitemradio' ? selected : undefined}
    aria-current={role === 'menuitem' && selected ? true : undefined}
    {...props}
    type={type}
    role={role}
    className={clsx('dropdown-item', `dropdown-item-${variant}`, className)}
  >
    {icon}
    <span className="dropdown-item-label">{children}</span>
    {trailing}
    {selected && showSelection && <Icon name="check-fill" className="dropdown-item-check" />}
  </button>
}
