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

const PierreFileIcon = lazy(() => import('./pierre-file-icon').catch(() => ({ default: FileIconFallback })))

/**
 * Shares Pierre's filename-aware artwork without loading it with the application shell.
 */
export function FileIcon(props: FileIconProps) {
  return <Suspense fallback={<Icon name="file-text" ariaLabel={props.ariaLabel} />}>
    <PierreFileIcon {...props} />
  </Suspense>
}
