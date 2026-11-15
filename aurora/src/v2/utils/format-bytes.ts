const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
const BYTES_PER_UNIT = 1_000

/**
 * Formats file sizes using decimal SI units, matching Finder: MB means
 * 1,000,000 bytes, not the binary MiB unit. Invalid sizes stay blank.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return ''
  }
  const unit = Math.min(BYTE_UNITS.length - 1, Math.max(0, Math.floor(Math.log(bytes || 1) / Math.log(BYTES_PER_UNIT))))

  return `${Number((bytes / BYTES_PER_UNIT ** unit).toFixed(2))} ${BYTE_UNITS[unit]}`
}
