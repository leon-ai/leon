import { LLMProviders } from '@/core/llm-manager/types'

export const LOCAL_LLM_CONTEXT_WINDOW_TOKENS = 16_384

/** Returns whether Leon runs the provider through a local inference server. */
export function isLocalLLMProvider(provider: LLMProviders): boolean {
  return provider === LLMProviders.LlamaCPP || provider === LLMProviders.SGLang
}
