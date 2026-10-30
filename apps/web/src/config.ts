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
