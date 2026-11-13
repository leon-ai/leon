import { lazy, Suspense } from 'react'
import { Icon } from './icon'

export interface FileIconProps {
  fileName: string
  ariaLabel?: string
  fallbackLabel?: string
}

/**
 * Keeps file labels readable even when optional artwork cannot be loaded.
 */
export function FileIconFallback({ ariaLabel, fallbackLabel }: FileIconProps) {
  return fallbackLabel ? <span>{fallbackLabel}</span> : <Icon name="file-text" ariaLabel={ariaLabel} />
}

const AtomFileIcon = lazy(() => import('./atom-file-icon').catch(() => ({ default: FileIconFallback })))

/**
 * Loads filename associations only when file artwork is needed. The local SVGs
 * are requested individually; unknown formats retain a readable fallback.
 */
export function FileIcon(props: FileIconProps) {
  return <Suspense fallback={<FileIconFallback {...props} />}>
    <AtomFileIcon {...props} />
  </Suspense>
}
