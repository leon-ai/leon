/**
 * Optional provider accounting. Missing values mean unavailable, not zero.
 */
export interface CompletionAccounting {
  cachedInputTokens?: number | undefined
  cacheWriteInputTokens?: number | undefined
  costUSD?: number | undefined
  costEstimated?: boolean | undefined
  costSource?: string | undefined
}

export interface UsageAccounting {
  cachedInputTokens: number
  cacheReadCompletionCount: number
  cacheWriteInputTokens: number
  costUSD: number
  costCompletionCount: number
  estimatedCostCompletionCount: number
  costSources: string[]
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

function count(...values: unknown[]): number | undefined {
  return values.find((value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  ) as number | undefined
}

/**
 * Preserves normalized accounting and documented raw provider cache counters.
 * SDK input totals already include cache reads/writes, including Anthropic.
 */
export function readCompletionAccounting(usage: unknown): CompletionAccounting {
  const data = object(usage)
  const normalized = object(data['accounting'])
  const raw = object(data['raw'])
  const input = object(data['inputTokens'])
  const details = object(data['prompt_tokens_details'] ?? data['input_tokens_details'])
  const rawDetails = object(raw['prompt_tokens_details'] ?? raw['input_tokens_details'])
  const cachedInputTokens = count(
    normalized['cachedInputTokens'],
    details['cached_tokens'], rawDetails['cached_tokens'],
    data['cache_read_input_tokens'], data['prompt_cache_hit_tokens'],
    raw['cache_read_input_tokens'], raw['prompt_cache_hit_tokens'],
    // Some compatible SDKs synthesize zero when the provider omits caching.
    data['raw'] == null ? input['cacheRead'] : undefined
  )
  const cacheWriteInputTokens = count(
    normalized['cacheWriteInputTokens'],
    input['cacheWrite'], data['cache_creation_input_tokens'], raw['cache_creation_input_tokens']
  )
  const costUSD = count(normalized['costUSD'], data['cost'], raw['cost'])
  return {
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens } : {}),
    ...(costUSD !== undefined ? {
      costUSD, costEstimated: normalized['costEstimated'] === true,
      costSource: typeof normalized['costSource'] === 'string'
        ? normalized['costSource'] : 'provider-reported'
    } : {})
  }
}

/**
 * Accumulates only observed calls; coverage counters prevent partial totals
 * from being presented as the cost/cache rate of a whole turn.
 */
export function accumulateUsageAccounting(
  previous: UsageAccounting | undefined,
  usage: CompletionAccounting | undefined
): UsageAccounting {
  return {
    cachedInputTokens: (previous?.cachedInputTokens ?? 0) + (usage?.cachedInputTokens ?? 0),
    cacheReadCompletionCount: (previous?.cacheReadCompletionCount ?? 0) +
      (usage?.cachedInputTokens !== undefined ? 1 : 0),
    cacheWriteInputTokens: (previous?.cacheWriteInputTokens ?? 0) + (usage?.cacheWriteInputTokens ?? 0),
    costUSD: (previous?.costUSD ?? 0) + (usage?.costUSD ?? 0),
    costCompletionCount: (previous?.costCompletionCount ?? 0) + (usage?.costUSD !== undefined ? 1 : 0),
    estimatedCostCompletionCount: (previous?.estimatedCostCompletionCount ?? 0) +
      (usage?.costUSD !== undefined && usage.costEstimated ? 1 : 0),
    costSources: [...new Set([
      ...(previous?.costSources ?? []), ...(usage?.costSource ? [usage.costSource] : [])
    ])]
  }
}

/**
 * Validates persisted/wire accounting without turning absent fields into zeros.
 */
export function readUsageAccounting(value: unknown): UsageAccounting | undefined {
  const data = object(value)
  const keys = [
    'cachedInputTokens', 'cacheReadCompletionCount', 'cacheWriteInputTokens',
    'costUSD', 'costCompletionCount', 'estimatedCostCompletionCount'
  ] as const
  if (!keys.every((key) => count(data[key]) !== undefined)) {
    return undefined
  }
  return {
    ...Object.fromEntries(keys.map((key) => [key, data[key]])),
    costSources: Array.isArray(data['costSources'])
      ? data['costSources'].filter((source): source is string => typeof source === 'string')
      : []
  } as UsageAccounting
}
