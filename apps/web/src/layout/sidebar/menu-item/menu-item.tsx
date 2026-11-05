import { Icon } from '@/components/icon'
import type { ComponentType, MouseEvent , ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { clsx } from 'clsx'

import { Tooltip } from '@/components/tooltip'

import './menu-item.sass'

type AppRouteTo = '/'
type MenuItemShortcutKey = string | {
  iconName: string
  label: string
}

function renderShortcutHint(
  shortcutKeys: MenuItemShortcutKey[] | undefined
): ReactNode {
  if (shortcutKeys === undefined) {
    return undefined
  }

  return shortcutKeys.map((shortcutKey, shortcutKeyIndex) => (
    <span className="menu-item-tooltip-shortcut" key={
      typeof shortcutKey === 'string'
        ? `${shortcutKey}-${shortcutKeyIndex}`
        : shortcutKey.label
    }>
      {shortcutKeyIndex > 0 && (
        <span className="menu-item-tooltip-shortcut-separator">
          +
        </span>
      )}
      {typeof shortcutKey === 'string' ? (
        <span>{shortcutKey}</span>
      ) : (
        <Icon name={`${shortcutKey.iconName}-line`} className="tooltip-hint-icon" ariaLabel={shortcutKey.label} />
      )}
    </span>
  ))
}

interface MenuItemBaseProps {
  iconName: string
  label: string
  badge?: ComponentType
  shortcutKeys?: MenuItemShortcutKey[]
  collapsed?: boolean
  disabled?: boolean
  onClick?: () => void
}

type MenuItemProps = MenuItemBaseProps & (
  | {
    to?: undefined
    href?: undefined
  }
  | {
    to: AppRouteTo
    href?: never
  }
  | {
    to?: never
    href: string
  }
)

export function MenuItem({
  iconName,
  label,
  to,
  href,
  badge: Badge,
  shortcutKeys,
  collapsed = false,
  disabled = false,
  onClick
}: MenuItemProps) {
  const className = clsx(
    'menu-item',
    { 'menu-item-collapsed': collapsed }
  )
  const content = (
    <>
      <Icon name={`${iconName}-line`} className="menu-item-icon" />
      <span className="menu-item-label">{label}</span>
      {shortcutKeys !== undefined && (
        <span className="menu-item-shortcut" aria-hidden="true">
          {shortcutKeys.map((shortcutKey) => {
            if (typeof shortcutKey === 'string') {
              return (
                <span
                  className={clsx('menu-item-shortcut-key', {
                    'menu-item-shortcut-key-wide': shortcutKey.length > 3
                  })}
                  key={shortcutKey}
                >
                  {shortcutKey}
                </span>
              )
            }

            return (
              <span className="menu-item-shortcut-key" key={shortcutKey.label}>
                <Icon name={`${shortcutKey.iconName}-line`} className="menu-item-shortcut-icon" />
              </span>
            )
          })}
        </span>
      )}
      {Badge && <Badge />}
    </>
  )

  const item = (() => {
    if (to !== undefined) {
      return (
        <Link
          to={to}
          className={className}
          activeProps={{ className: 'menu-item-active' }}
          aria-disabled={disabled}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (disabled) {
              event.preventDefault()
              return
            }

            onClick?.()
          }}
        >
          {content}
        </Link>
      )
    }

    if (href !== undefined) {
      return (
        <a
          href={href}
          className={className}
          aria-disabled={disabled}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (disabled) {
              event.preventDefault()
              return
            }

            onClick?.()
          }}
        >
          {content}
        </a>
      )
    }

    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={onClick}
      >
        {content}
      </button>
    )
  })()

  if (!collapsed) {
    return item
  }

  return (
    <Tooltip
      message={label}
      hint={renderShortcutHint(shortcutKeys)}
      position="right"
    >
      {item}
    </Tooltip>
  )
}
