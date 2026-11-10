import { useState } from 'react'
import { clsx } from 'clsx'

import { Icon } from '@/components/icon'
import './package-icon.sass'

interface PackageIconProps {
  logoUrl?: string | undefined
  // Trusted bundled artwork for offline views, never a widget-supplied URL.
  assetSrc?: string | undefined
  iconName: string
  fallbackName?: string | undefined
  className?: string
}

/**
 * Shares original catalog artwork and explicitly masked activity glyphs, with
 * declared-icon and generic fallbacks. SVG markup is never parsed or injected.
 */
export function PackageIcon({ logoUrl, assetSrc, iconName, fallbackName, className }: PackageIconProps) {
  const [failed, setFailed] = useState<string>()
  const source = assetSrc ?? (logoUrl && !logoUrl.includes('?') && !logoUrl.includes('#') &&
    (logoUrl.startsWith('tools/') || logoUrl.startsWith('skills/')) && logoUrl.endsWith('/assets/logo.svg')
    ? `/api/v1/${logoUrl}` : undefined)

  if (!source || failed === source) {
    return <Icon name={iconName} fallbackName={fallbackName} className={clsx('package-icon', className)} />
  }

  return <img className={clsx('app-icon', 'package-icon', className)} src={source}
    alt="" loading="lazy" decoding="async" onError={() => setFailed(source)} />
}
