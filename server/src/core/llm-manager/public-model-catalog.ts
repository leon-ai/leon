import {
  getLLMModelCatalogEntries,
  getLLMModelCatalogProviders,
  getLLMModelDefaultReasoning
} from './llm-model-catalog'
import type { LLMModelReasoning, LLMModelSpeed } from './llm-model-catalog'
import type { LLMReasoningEffort } from './types'
import { getLLMProviderAccountConfig } from './llm-provider-account-configs'

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
export function getPublicModelCatalog(): PublicModelProvider[] {
  return getLLMModelCatalogProviders().map((provider) => ({
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
}
