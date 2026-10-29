import type { CSSProperties } from 'react'
import { clsx } from 'clsx'

import { getPublicAssetPath } from '@/config'

import './llm-provider-icon.sass'

export interface LLMProviderIconProps {
  provider: string
  size?: number
  className?: string
  ariaLabel?: string
}

/**
 * Displays a provider's local brand mark in the surrounding text color.
 * Defaults to the surrounding font size unless an explicit size is supplied.
 * Icons beside a visible label stay decorative; standalone icons can supply a label.
 */
export function LLMProviderIcon({
  provider,
  size,
  className,
  ariaLabel
}: LLMProviderIconProps) {
  return (
    <span
      className={clsx('llm-provider-icon', className)}
      role={ariaLabel === undefined ? undefined : 'img'}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel === undefined ? true : undefined}
      style={{
        '--llm-provider-icon-image': `url("${getPublicAssetPath(`img/providers/${provider}.svg`)}")`,
        ...(size === undefined ? {} : { '--llm-provider-icon-size': `${size}px` })
      } as CSSProperties}
    />
  )
}
