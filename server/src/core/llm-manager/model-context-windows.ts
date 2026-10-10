import { LLMProviders } from '@/core/llm-manager/types'
import { getLLMModelCatalogEntry } from '@/core/llm-manager/llm-model-catalog'

export const LOCAL_LLM_CONTEXT_WINDOW_TOKENS = 16_384

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
