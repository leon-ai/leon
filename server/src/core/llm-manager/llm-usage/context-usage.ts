/**
 * Prompt occupancy for one model request, independent of cumulative turn usage.
 * Missing capacity means the endpoint's context limit is unknown.
 */
export interface ContextUsageMetrics {
  contextUsedTokens: number
  contextWindowTokens?: number
  contextUsagePercent?: number
  contextUsageEstimated: boolean
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
}): ContextUsageMetrics {
  const contextUsageEstimated = !isTokenCount(params.usedInputTokens)
  const contextUsedTokens = contextUsageEstimated
    ? params.estimatedInputTokens
    : params.usedInputTokens as number
  const contextWindowTokens = params.contextWindowTokens

  return {
    contextUsedTokens,
    contextUsageEstimated,
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

  return captureContextUsage({
    usedInputTokens: record['contextUsageEstimated']
      ? undefined
      : record['contextUsedTokens'],
    estimatedInputTokens: record['contextUsedTokens'],
    contextWindowTokens: isTokenCount(record['contextWindowTokens'])
      ? record['contextWindowTokens']
      : undefined
  })
}
