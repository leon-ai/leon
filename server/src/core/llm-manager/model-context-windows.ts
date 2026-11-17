import { LLMProviders } from '@/core/llm-manager/types'
import { getLLMModelCatalogEntry } from '@/core/llm-manager/llm-model-catalog'

export const LOCAL_LLM_CONTEXT_WINDOW_TOKENS = 16_384
const UNKNOWN_REMOTE_CONTEXT_WINDOW_TOKENS = 128_000
const OPENAI_NATIVE_COMPACTION_RATIO = 0.9
const OPENAI_MINIMUM_COMPACTION_THRESHOLD_TOKENS = 1_000

/**
 * Resolves a known endpoint capacity without fetching model metadata. Leon owns
 * llama.cpp's window; independently hosted servers need verified metadata.
 */
export function resolveModelContextWindowTokens(
  provider: LLMProviders | null,
  model: string
): number | undefined {
  if (provider === LLMProviders.LlamaCPP) {
    return LOCAL_LLM_CONTEXT_WINDOW_TOKENS
  }

  return getLLMModelCatalogEntry(provider, model)?.contextWindowTokens
}

/**
 * Returns whether Leon runs the provider through a local inference server.
 */
export function isLocalLLMProvider(provider: LLMProviders): boolean {
  return provider === LLMProviders.LlamaCPP || provider === LLMProviders.SGLang
}

/**
 * Keeps a conservative input budget when an endpoint has no capacity metadata.
 */
export function resolveAgentBudgetContextWindowTokens(
  provider: LLMProviders,
  contextWindowTokens?: number
): number {
  return contextWindowTokens ?? (isLocalLLMProvider(provider)
    ? LOCAL_LLM_CONTEXT_WINDOW_TOKENS
    : UNKNOWN_REMOTE_CONTEXT_WINDOW_TOKENS)
}

/**
 * Follows Codex's 90% ceiling and reserves any larger explicitly requested output.
 * Returns unknown when we cannot set a valid threshold for the endpoint.
 */
export function resolveOpenAINativeCompactionTriggerTokens(
  model: string,
  requestedOutputTokens = 0
): number | undefined {
  const capacity = resolveModelContextWindowTokens(LLMProviders.OpenAI, model)
  if (capacity === undefined) {
    return undefined
  }

  const threshold = Math.min(
    Math.floor(capacity * OPENAI_NATIVE_COMPACTION_RATIO),
    capacity - requestedOutputTokens
  )
  return threshold >= OPENAI_MINIMUM_COMPACTION_THRESHOLD_TOKENS
    ? threshold
    : undefined
}
