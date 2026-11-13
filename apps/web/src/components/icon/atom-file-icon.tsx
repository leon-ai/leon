import { useState } from 'react'
import { getPublicAssetPath } from '@/config'
import { useTheme } from '@/hooks/use-theme'
import { FileIconFallback, type FileIconProps } from './file-icon'
import registry from './file-icon-assets.json'

import './file-icon.sass'

const MAXIMUM_CACHED_FILENAMES = 512
const MAXIMUM_FILENAME_CHARACTERS = 512
const RULES = registry.rules.map(([pattern, asset]) => ({
  pattern: new RegExp(`^(?:${pattern})$`, 'i'),
  asset: asset!
}))
const DARK_VARIANTS = new Set<string>(registry.dark)
const filenameCache = new Map<string, string | undefined>()

function resolveFileIcon(fileName: string): string | undefined {
  if (fileName.length > MAXIMUM_FILENAME_CHARACTERS) {
    return undefined
  }

  const key = fileName.toLowerCase()
  if (filenameCache.has(key)) {
    const cached = filenameCache.get(key)
    filenameCache.delete(key)
    filenameCache.set(key, cached)

    return cached
  }

  const asset = RULES.find(({ pattern }) => pattern.test(fileName))?.asset
  if (filenameCache.size >= MAXIMUM_CACHED_FILENAMES) {
    filenameCache.delete(filenameCache.keys().next().value!)
  }
  filenameCache.set(key, asset)

  return asset
}

/**
 * Resolves trusted Atom file artwork without downloading an icon catalog or
 * injecting SVG. Filename results are bounded and shared across mounted views.
 */
export default function AtomFileIcon(props: FileIconProps) {
  const theme = useTheme()
  const asset = resolveFileIcon(props.fileName)
  const variant = asset && theme === 'dark' && DARK_VARIANTS.has(asset) ? `${asset}_dark` : asset
  const [failedAsset, setFailedAsset] = useState<string>()

  if (!variant || failedAsset === variant) {
    return <FileIconFallback {...props} />
  }

  return <img className="app-icon file-icon" data-file-icon={asset}
    src={getPublicAssetPath(`img/file-icons/${registry.assetVersion}/${variant}.svg`)} alt={props.ariaLabel ?? ''}
    loading="lazy" decoding="async" onError={() => setFailedAsset(variant)} />
}
