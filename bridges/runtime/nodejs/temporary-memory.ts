const DAY_MS = 24 * 60 * 60 * 1_000
const CONTEXT_ENVELOPE_BUDGET = 64

export interface TemporaryMemoryPolicy {
  defaultDays: number
  maximumDays: number
  maxItems: number
  tokenBudget: number
}

export const DEFAULT_TEMPORARY_MEMORY_POLICY: TemporaryMemoryPolicy = {
  defaultDays: 7,
  maximumDays: 30,
  maxItems: 10,
  tokenBudget: 600
}

/**
 * Conservatively bound serialized context across languages, including its envelope.
 */
export function getTemporaryContextSize(entries: readonly unknown[]): number {
  return Buffer.byteLength(JSON.stringify({ temporary_context: entries }), 'utf8') + CONTEXT_ENVELOPE_BUDGET
}

/**
 * Resolve the same profile-owned memory settings in Core and tool workers.
 */
export function resolveTemporaryMemoryPolicy(settings: Record<string, unknown>): TemporaryMemoryPolicy {
  const policy = { ...DEFAULT_TEMPORARY_MEMORY_POLICY }
  const values = settings['temporaryContext']
  if (values && typeof values === 'object') {
    for (const key of Object.keys(policy) as Array<keyof TemporaryMemoryPolicy>) {
      const value = (values as Record<string, unknown>)[key]
      if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        policy[key] = value
      }
    }
  }
  policy.defaultDays = Math.min(policy.defaultDays, policy.maximumDays)
  return policy
}

/**
 * Temporary state always expires; explicit dates cannot exceed its retention cap.
 */
export function resolveTemporaryExpiration(now: number, expiresAt: number | null | undefined, policy: TemporaryMemoryPolicy): number {
  const expiration = expiresAt ?? now + policy.defaultDays * DAY_MS
  if (!Number.isFinite(expiration) || expiration <= now) {
    throw new Error('Temporary memory expiration must be in the future.')
  }
  return Math.min(expiration, now + policy.maximumDays * DAY_MS)
}
