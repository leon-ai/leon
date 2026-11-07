import path from 'node:path'

import {
  getLLMModelCatalogEntries,
  getLLMModelCatalogProviders,
  getLLMModelDefaultReasoning
} from './llm-model-catalog'
import type { LLMModelReasoning, LLMModelSpeed } from './llm-model-catalog'
import type { LLMReasoningEffort } from './types'
import { getLLMProviderAccountConfig } from './llm-provider-account-configs'
import { LLMProviders } from './types'

interface PublicModelProvider {
  id: string
  label: string
  models: {
    model: string
    label: string
    recommended: boolean
    reasoning: readonly LLMModelReasoning[]
    speed: readonly LLMModelSpeed[]
    defaultReasoningLabel: string
    defaultReasoningEffort?: LLMReasoningEffort
  }[]
}

/**
 * Projects selector capabilities without exposing account configuration or secrets.
 */
export function getPublicModelCatalog(localModels: readonly string[] = []): PublicModelProvider[] {
  const providers: PublicModelProvider[] = getLLMModelCatalogProviders().map((provider) => ({
    id: provider,
    label: getLLMProviderAccountConfig(provider)?.label ?? provider,
    models: getLLMModelCatalogEntries(provider).map((entry) => {
      const defaults = getLLMModelDefaultReasoning(provider, entry.model)

      return {
        model: entry.model,
        label: entry.label,
        recommended: Boolean(entry.recommended),
        reasoning: entry.reasoning,
        speed: entry.speed,
        defaultReasoningLabel: defaults.label,
        ...(defaults.effort === undefined ? {} : { defaultReasoningEffort: defaults.effort })
      }
    })
  }))

  if (localModels.length > 0) {
    providers.push({
      id: LLMProviders.LlamaCPP,
      label: 'llama.cpp',
      models: localModels.map((model) => ({
        model,
        label: path.parse(model).name,
        recommended: false,
        // Unknown GGUF templates retain their own reasoning defaults.
        reasoning: ['auto'],
        speed: ['auto'],
        defaultReasoningLabel: 'Model default'
      }))
    })
  }

  return providers
}
