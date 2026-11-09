import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { Button as AuroraButton, type ButtonProps as AuroraButtonProps } from '../../../../../aurora/src/v2/components/button/button'
import { Icon } from '@/components/icon'
import { Tooltip, type TooltipPosition } from '@/components/tooltip'

export type { ButtonVariant } from '../../../../../aurora/src/v2/components/button/button'

type ButtonBaseProps = Omit<AuroraButtonProps, 'renderLink' | 'href' | 'target' | 'rel' | 'type'> & {
  iconName?: string
  iconType?: 'line' | 'fill' | null
  tooltipMessage?: string
  tooltipPosition?: TooltipPosition
}

type ButtonProps = ButtonBaseProps & (
  | { to?: undefined, href?: undefined, type?: 'button' | 'submit', target?: never, rel?: never }
  | { to: '/', href?: never, type?: never, target?: never, rel?: never }
  | { to?: never, href: string, type?: never, target?: string, rel?: string }
)

/**
 * Keeps application routing, tooltips and icon resolution outside the shared control.
 */
export function Button({
  to, icon, iconName, iconType = 'line', tooltipMessage,
  tooltipPosition = 'bottom', ariaLabel, ...props
}: ButtonProps) {
  const iconContent: ReactNode = icon !== undefined ? icon : (iconName ? (
    <Icon name={iconType === null ? iconName : `${iconName}-${iconType}`} selected={props.ariaPressed} morph />
  ) : undefined)
  const button = <AuroraButton
    {...props}
    icon={iconContent}
    {...(ariaLabel !== undefined || props.children === undefined && tooltipMessage !== undefined
      ? { ariaLabel: ariaLabel ?? tooltipMessage! } : {})}
    {...(to === undefined ? {} : { renderLink: (linkProps) => <Link {...linkProps} to={to} /> })}
  />

  return tooltipMessage === undefined ? button : (
    <Tooltip message={tooltipMessage} position={tooltipPosition}>{button}</Tooltip>
  )
}
