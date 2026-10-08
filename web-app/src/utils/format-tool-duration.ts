const MILLISECONDS_PER_SECOND = 1_000
const SECONDS_PER_MINUTE = 60

/**
 * Formats elapsed durations for Leon clients; missing timings stay blank.
 */
export function formatToolDuration(durationMs?: number): string {
  if (
    durationMs === undefined ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return ''
  }

  if (durationMs < MILLISECONDS_PER_SECOND) {
    return `${Math.round(durationMs)} ms`
  }

  const seconds = durationMs / MILLISECONDS_PER_SECOND

  if (seconds < SECONDS_PER_MINUTE) {
    return `${Number(seconds.toFixed(1))} s`
  }

  // Round before splitting so a duration never displays a 60-second remainder.
  const roundedSeconds = Math.round(seconds)
  const minutes = Math.floor(roundedSeconds / SECONDS_PER_MINUTE)
  const remainingSeconds = roundedSeconds % SECONDS_PER_MINUTE

  return `${minutes}m ${remainingSeconds}s`
}
