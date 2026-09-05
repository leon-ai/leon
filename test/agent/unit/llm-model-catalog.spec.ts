import { describe, expect, it } from 'vitest'

import {
  canDisableLLMModelReasoning,
  getLLMModelCatalogEntries,
  getLLMModelCatalogEntry,
  LLM_MODEL_CATALOG,
  LLM_MODEL_REASONING_VALUES,
  LLM_MODEL_SPEED_VALUES
} from '@/core/llm-manager/llm-model-catalog'
import { LLMProviders } from '@/core/llm-manager/types'

describe('LLM model catalog', () => {
  it('contains unique provider/model entries with auto defaults', () => {
    const targetKeys = LLM_MODEL_CATALOG.map(
      (entry) => `${entry.provider}/${entry.model}`
    )

    expect(new Set(targetKeys).size).toBe(targetKeys.length)

    for (const entry of LLM_MODEL_CATALOG) {
      expect(entry.reasoning[0]).toBe('auto')
      expect(entry.speed[0]).toBe('auto')
      expect(entry.reasoning.every((value) =>
        LLM_MODEL_REASONING_VALUES.includes(value)
      )).toBe(true)
      expect(entry.speed.every((value) =>
        LLM_MODEL_SPEED_VALUES.includes(value)
      )).toBe(true)
    }
  })

  it('exposes model-dependent reasoning and speed values', () => {
    const openAIModel = getLLMModelCatalogEntry(
      LLMProviders.OpenAI,
      'gpt-5.6-sol'
    )
    const anthropicModel = getLLMModelCatalogEntry(
      LLMProviders.Anthropic,
      'claude-opus-5'
    )

    expect(openAIModel?.reasoning).toContain('xhigh')
    expect(openAIModel?.speed).toEqual(['auto', 'normal', 'fast'])
    expect(anthropicModel?.reasoning).toContain('xhigh')
    expect(anthropicModel?.speed).toEqual(['auto', 'normal', 'fast'])
    expect(LLM_MODEL_REASONING_VALUES).not.toContain('ultra')
  })

  it('keeps gateway and direct-provider capabilities distinct', () => {
    expect(getLLMModelCatalogEntry(
      LLMProviders.OpenRouter,
      'z-ai/glm-5.2'
    )?.reasoning).toEqual(['auto', 'none', 'high', 'xhigh'])
    expect(getLLMModelCatalogEntry(
      LLMProviders.ZAI,
      'glm-5.2'
    )?.reasoning).toEqual([
      'auto',
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max'
    ])
    expect(getLLMModelCatalogEntry(
      LLMProviders.OpenRouter,
      'moonshotai/kimi-k3'
    )?.reasoning).toEqual(['auto', 'none', 'low', 'high', 'max'])
    expect(getLLMModelCatalogEntry(
      LLMProviders.MoonshotAI,
      'kimi-k3'
    )?.reasoning).toEqual(['auto', 'low', 'high', 'max'])
  })

  it('uses explicit on only for models with toggle-only reasoning', () => {
    expect(getLLMModelCatalogEntry(
      LLMProviders.ZAI,
      'glm-5.1'
    )?.reasoning).toEqual(['auto', 'on', 'none'])
    expect(getLLMModelCatalogEntry(
      LLMProviders.Anthropic,
      'claude-fable-5'
    )?.reasoning).not.toContain('none')
    expect(getLLMModelCatalogEntry(
      LLMProviders.OpenAI,
      'gpt-5.4-mini'
    )?.speed).toEqual(['auto'])
    expect(getLLMModelCatalogEntry(
      LLMProviders.OpenRouter,
      'google/gemini-3.5-flash-lite'
    )?.reasoning).toEqual(['auto'])
    expect(canDisableLLMModelReasoning(
      LLMProviders.OpenRouter,
      'google/gemini-3.5-flash-lite'
    )).toBe(false)
  })

  it('preserves curated setup order and recommendations', () => {
    const openAIModels = getLLMModelCatalogEntries(LLMProviders.OpenAI)

    expect(openAIModels[0]).toMatchObject({
      model: 'gpt-6-astra',
      recommended: true
    })
  })
})
