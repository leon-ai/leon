// Only discovery context crosses this boundary, never owner memory, browser
// history, raw state files or arbitrary profile paths.
export const SATELLITE_CONTEXT_FILES = ['ACTIVITY.md', 'LOCAL_INVENTORY.md'] as const
export const SATELLITE_CONTEXT_REFRESH_MS = 10 * 60 * 1_000
export const SATELLITE_CONTEXT_MAX_AGE_MS = 2 * SATELLITE_CONTEXT_REFRESH_MS
const MAX_CONTEXT_FILE_CHARS = 32_000

export interface SatelliteContextSnapshot {
  files: Partial<Record<(typeof SATELLITE_CONTEXT_FILES)[number], string>>
}

/**
 * Validate untrusted device context without accepting filenames or credentials
 * supplied by a peer as filesystem paths.
 */
export function parseSatelliteContext(value: unknown): SatelliteContextSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const files = (value as SatelliteContextSnapshot).files
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null
  if (Object.keys(files).some((name) => !SATELLITE_CONTEXT_FILES.includes(name as typeof SATELLITE_CONTEXT_FILES[number]))) return null
  const result: SatelliteContextSnapshot = { files: {} }
  for (const name of SATELLITE_CONTEXT_FILES) {
    const content = files[name]
    if (content === undefined) continue
    if (typeof content !== 'string' || content.length > MAX_CONTEXT_FILE_CHARS) return null
    result.files[name] = content
  }
  return result
}
