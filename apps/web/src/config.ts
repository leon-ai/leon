import { version } from '../../../package.json'

declare const LEON_BUILD_VERSION_SUFFIX: string

/**
 * Keeps the installed web app's version aligned with the root release manifest.
 */
export const LEON_VERSION = version

export const LEON_VERSION_SUFFIX = typeof LEON_BUILD_VERSION_SUFFIX === 'string' ? LEON_BUILD_VERSION_SUFFIX : ''

/**
 * Development uses Vite's same-origin API proxy, preserving profile cookies.
 */
export const LEON_SERVER_URL = ''

/**
 * Resolve a public asset against Vite's development or production base path.
 */
export function getPublicAssetPath(assetPath: string): string {
  const relativeAssetPath = assetPath.startsWith('/')
    ? assetPath.slice(1)
    : assetPath

  return `${import.meta.env.BASE_URL}${relativeAssetPath}`
}
