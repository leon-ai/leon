import type { CSSProperties } from 'react'

import { getPublicAssetPath } from '@/config'

interface ProviderLogoProps {
  provider: string
}

/**
 * Renders a local SVG brand mark using the surrounding theme's text color.
 */
export function ProviderLogo({ provider }: ProviderLogoProps) {
  return (
    <span
      className="model-provider-logo"
      aria-hidden="true"
      style={{
        '--provider-logo': `url("${getPublicAssetPath(`img/providers/${provider}.svg`)}")`
      } as CSSProperties}
    />
  )
}
