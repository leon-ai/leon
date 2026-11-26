export interface ContextTokenBreakdown {
  transcript: number
  system: number
  tools: number
  images: number
  compaction: number
}

/**
 * Prompt occupancy for one model request, independent of cumulative turn usage.
 * Missing capacity means the endpoint's context limit is unknown.
 */
export interface ContextUsageMetrics {
  contextUsedTokens: number
  contextWindowTokens?: number
  contextUsagePercent?: number
  contextUsageEstimated: boolean
  contextTokenBreakdown?: ContextTokenBreakdown
  contextTarget?: { provider: string, model: string }
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Uses provider input totals, including cached tokens, when available. Estimates
 * describe the prepared prompt until the request reports its actual usage.
 */
export function captureContextUsage(params: {
  usedInputTokens?: number | undefined
  estimatedInputTokens: number
  contextWindowTokens?: number | undefined
  contextTokenBreakdown?: ContextTokenBreakdown | undefined
  contextTarget?: ContextUsageMetrics['contextTarget']
}): ContextUsageMetrics {
  const contextUsageEstimated = !isTokenCount(params.usedInputTokens)
  const contextUsedTokens = contextUsageEstimated
    ? params.estimatedInputTokens
    : params.usedInputTokens as number
  const contextWindowTokens = params.contextWindowTokens

  return {
    contextUsedTokens,
    contextUsageEstimated,
    ...(params.contextTarget ? { contextTarget: params.contextTarget } : {}),
    ...(params.contextTokenBreakdown ? { contextTokenBreakdown: params.contextTokenBreakdown } : {}),
    ...(isTokenCount(contextWindowTokens) && contextWindowTokens > 0
      ? {
          contextWindowTokens,
          contextUsagePercent: Number(
            ((contextUsedTokens / contextWindowTokens) * 100).toFixed(2)
          )
        }
      : {})
  }
}

/**
 * Preserves context snapshots across answer delivery and history without
 * interpreting absent or malformed metrics as an empty context window.
 */
export function readContextUsage(value: unknown): ContextUsageMetrics | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>

  if (
    !isTokenCount(record['contextUsedTokens']) ||
    typeof record['contextUsageEstimated'] !== 'boolean'
  ) {
    return undefined
  }

  const target = record['contextTarget'] as Partial<NonNullable<ContextUsageMetrics['contextTarget']>> | undefined
  const contextTarget = typeof target?.provider === 'string' && typeof target.model === 'string'
    ? { provider: target.provider, model: target.model } : undefined
  const breakdown = record['contextTokenBreakdown'] as Partial<ContextTokenBreakdown> | undefined
  const contextTokenBreakdown = breakdown &&
    isTokenCount(breakdown.transcript) && isTokenCount(breakdown.system) &&
    isTokenCount(breakdown.tools) && isTokenCount(breakdown.images) && isTokenCount(breakdown.compaction)
    ? {
        transcript: breakdown.transcript, system: breakdown.system,
        tools: breakdown.tools, images: breakdown.images, compaction: breakdown.compaction
      } : undefined

  return captureContextUsage({
    contextTarget,
    contextTokenBreakdown,
    usedInputTokens: record['contextUsageEstimated']
      ? undefined
      : record['contextUsedTokens'],
    estimatedInputTokens: record['contextUsedTokens'],
    contextWindowTokens: isTokenCount(record['contextWindowTokens'])
      ? record['contextWindowTokens']
      : undefined
  })
}
