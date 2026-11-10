import { useState, type CSSProperties } from 'react'
import { clsx } from 'clsx'

import { Icon } from '@/components/icon'
import { LogoMaskMode } from '../../../../../aurora/src/contracts/package-logo'
import './package-icon.sass'

interface PackageIconProps {
  logoUrl?: string | undefined
  // Trusted bundled artwork for offline views, never a widget-supplied URL.
  assetSrc?: string | undefined
  maskMode?: LogoMaskMode | undefined
  iconName: string
  fallbackName?: string | undefined
  className?: string
}

/**
 * Shares original catalog artwork and explicitly masked activity glyphs, with
 * declared-icon and generic fallbacks. SVG markup is never parsed or injected.
 */
export function PackageIcon({ logoUrl, assetSrc, maskMode, iconName, fallbackName, className }: PackageIconProps) {
  const [failed, setFailed] = useState<string>()
  const source = assetSrc ?? (logoUrl && !logoUrl.includes('?') && !logoUrl.includes('#') &&
    (logoUrl.startsWith('tools/') || logoUrl.startsWith('skills/')) && logoUrl.endsWith('/assets/logo.svg')
    ? `/api/v1/${logoUrl}` : undefined)

  const supported = maskMode !== LogoMaskMode.InverseLuminance ||
    typeof CSS !== 'undefined' && CSS.supports('mask-mode', 'luminance') && CSS.supports('mask-composite', 'subtract')

  if (!source || failed === source || !supported) {
    return <Icon name={iconName} fallbackName={fallbackName} className={clsx('package-icon', className)} />
  }
  if (maskMode) {
    // CSS masks have no error event; a native image shares the resource and
    // enables the same fallback without parsing SVG markup or managing a loader.
    return <span className={clsx('app-icon', 'app-icon-mask', 'package-icon', 'package-icon-mask', className)}
      data-logo-mask={maskMode} aria-hidden="true"
      style={{ '--app-icon-image': `url(${JSON.stringify(source)})` } as CSSProperties}>
      <img className="package-icon-probe" src={source} alt="" onError={() => setFailed(source)} />
    </span>
  }

  return <img className={clsx('app-icon', 'package-icon', className)} src={source}
    alt="" loading="lazy" decoding="async" onError={() => setFailed(source)} />
}
