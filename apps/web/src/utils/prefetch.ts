const CONSTRAINED_CONNECTION_TYPES = new Set(['slow-2g', '2g', '3g'])

/**
 * Leaves limited connections for requested content rather than speculative work.
 */
export function canPrefetch(): boolean {
  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string, saveData?: boolean }
  }).connection

  return navigator.onLine && connection?.saveData !== true &&
    !CONSTRAINED_CONNECTION_TYPES.has(connection?.effectiveType ?? '')
}

/**
 * Warms optional code without surfacing speculative failures as request errors.
 * Actual rendering still uses its normal loading and failure handling.
 */
export function prefetchModule(load: () => Promise<unknown>): void {
  if (canPrefetch()) {
    void load().catch(() => undefined)
  }
}
