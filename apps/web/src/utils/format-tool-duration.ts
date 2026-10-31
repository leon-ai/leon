const MILLISECONDS_PER_SECOND = 1_000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60

export enum DurationFormat {
  Precise = 'precise',
  Compact = 'compact'
}

/**
 * Formats elapsed durations precisely or compactly, preserving milliseconds
 * below one second. Missing and invalid timings stay blank.
 */
export function formatToolDuration(
  durationMs?: number,
  format: DurationFormat = DurationFormat.Precise
): string {
  if (
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return ''
  }

  if (durationMs < MILLISECONDS_PER_SECOND) {
    return `${Math.round(durationMs)}ms`
  }

  const seconds = durationMs / MILLISECONDS_PER_SECOND

  if (format === DurationFormat.Precise && seconds < SECONDS_PER_MINUTE) {
    return `${Number(seconds.toFixed(1))}s`
  }

  // Round before splitting so a duration never displays a 60-second remainder.
  const roundedSeconds = Math.round(seconds)
  const minutes = Math.floor(roundedSeconds / SECONDS_PER_MINUTE)
  const remainingSeconds = roundedSeconds % SECONDS_PER_MINUTE

  if (format === DurationFormat.Compact) {
    const hours = Math.floor(minutes / MINUTES_PER_HOUR)
    const remainingMinutes = minutes % MINUTES_PER_HOUR

    return [
      hours > 0 ? `${hours}h` : '',
      remainingMinutes > 0 ? `${remainingMinutes}m` : '',
      remainingSeconds > 0 || roundedSeconds === 0 ? `${remainingSeconds}s` : ''
    ].filter(Boolean).join(' ')
  }

  return `${minutes}m ${remainingSeconds}s`
}
