import { LLMProviders } from '@/core/llm-manager/types'

export const LOCAL_SERVER_PROVIDERS = new Set<LLMProviders>([
  LLMProviders.LlamaCPP,
  LLMProviders.SGLang
])

export const STREAM_IDLE_TIMEOUT_ERROR_NAME = 'LLMStreamIdleTimeout'
export const REQUEST_ACCEPTANCE_TIMEOUT_ERROR_NAME = 'LLMRequestAcceptanceTimeout'
