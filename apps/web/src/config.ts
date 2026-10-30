const developmentServerHost = import.meta.env['VITE_LEON_HOST']
const developmentServerPort = import.meta.env['VITE_LEON_PORT']

/**
 * Leon server origin used when Vite and Leon run on separate development ports.
 */
export const LEON_SERVER_URL = import.meta.env.PROD
  ? ''
  : `${developmentServerHost}:${developmentServerPort}`

/**
 * Resolve a public asset against Vite's development or production base path.
 */
export function getPublicAssetPath(assetPath: string): string {
  const relativeAssetPath = assetPath.startsWith('/')
    ? assetPath.slice(1)
    : assetPath

  return `${import.meta.env.BASE_URL}${relativeAssetPath}`
}
