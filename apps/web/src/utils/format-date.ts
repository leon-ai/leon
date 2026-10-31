const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', hour12: false
})
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' })
const DATE_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric', month: 'short', year: 'numeric'
})

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * Formats session recency consistently across the web app.
 */
export function formatRelativeDate(timestamp: number, now = Date.now()): string {
  const elapsedMs = Math.max(0, now - timestamp)
  const date = new Date(timestamp)
  const today = new Date(now)

  if (timestamp >= startOfDay(today)) {
    if (elapsedMs < MINUTE_MS) {
      return 'Just now'
    }
    if (elapsedMs < HOUR_MS) {
      const minutes = Math.floor(elapsedMs / MINUTE_MS)
      return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
    }
    const hours = Math.floor(elapsedMs / HOUR_MS)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  // Calendar arithmetic keeps yesterday correct across daylight-saving changes.
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (timestamp >= yesterday.getTime()) {
    return 'Yesterday'
  }

  return date.getFullYear() === today.getFullYear()
    ? DATE_FORMATTER.format(date) : DATE_WITH_YEAR_FORMATTER.format(date)
}

/**
 * Formats an activity's recorded clock time with a familiar calendar-day label.
 */
export function formatMetricTimestamp(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) {
    return ''
  }

  const today = new Date(now)
  const days = Math.round((startOfDay(today) - startOfDay(date)) / DAY_MS)
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday'
    : days > 1 && days < 7 ? WEEKDAY_FORMATTER.format(date)
      : date.getFullYear() === today.getFullYear()
        ? DATE_FORMATTER.format(date) : DATE_WITH_YEAR_FORMATTER.format(date)

  return `${day}, ${TIME_FORMATTER.format(date)}`
}

/**
 * Keeps the full local date and second-level precision available for inspection.
 */
export function formatFullMetricTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}
