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
import {
  LOCAL_LLM_CONTEXT_WINDOW_TOKENS,
  resolveModelContextWindowTokens
} from '@/core/llm-manager/model-context-windows'

describe('LLM model catalog', () => {
  it('resolves known capacities without assigning a default to independently hosted models', () => {
    expect(resolveModelContextWindowTokens(LLMProviders.OpenAI, 'gpt-6.1-sol'))
      .toBe(1_050_000)
    expect(resolveModelContextWindowTokens(LLMProviders.MiniMax, 'MiniMax-M3'))
      .toBe(1_000_000)
    expect(resolveModelContextWindowTokens(LLMProviders.OpenRouter, 'minimax/minimax-m3'))
      .toBe(1_048_576)
    expect(resolveModelContextWindowTokens(LLMProviders.LlamaCPP, 'local.gguf'))
      .toBe(LOCAL_LLM_CONTEXT_WINDOW_TOKENS)
    expect(resolveModelContextWindowTokens(LLMProviders.SGLang, 'custom-model'))
      .toBeUndefined()
    expect(resolveModelContextWindowTokens(LLMProviders.OpenAI, 'custom-model'))
      .toBeUndefined()
  })

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
    expect(getLLMModelCatalogEntries(LLMProviders.Anthropic)[0]).toMatchObject({
      model: 'claude-opus-5-5',
      recommended: true
    })
    expect(getLLMModelCatalogEntry(
      LLMProviders.Anthropic,
      'claude-fable-5-1'
    )?.recommended).toBeUndefined()
  })

  it.each([
    [LLMProviders.Anthropic, 'claude-opus-5-5'],
    [LLMProviders.OpenRouter, 'anthropic/claude-opus-5.5']
  ] as const)('protects Opus 5.5 request constraints for %s', (provider, model) => {
    expect(getLLMModelCatalogEntry(provider, model)).toMatchObject({
      recommended: true,
      supportsForcedToolChoice: false,
      supportsTemperature: false,
      reasoning: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
      speed: ['auto', 'normal', 'fast']
    })
    expect(canDisableLLMModelReasoning(provider, model)).toBe(false)
  })

  it.each([
    [LLMProviders.OpenAI, 'gpt-6-sol'],
    [LLMProviders.OpenAI, 'gpt-6-luna'],
    [LLMProviders.OpenRouter, 'openai/gpt-6-sol'],
    [LLMProviders.OpenRouter, 'openai/gpt-6-sol-pro'],
    [LLMProviders.OpenRouter, 'openai/gpt-6-luna'],
    [LLMProviders.OpenRouter, 'openai/gpt-6-luna-pro']
  ] as const)('allows optional reasoning for %s/%s', (provider, model) => {
    expect(getLLMModelCatalogEntry(provider, model)).toMatchObject({
      supportsTemperature: false,
      reasoning: ['auto', 'none', 'low', 'medium', 'high', 'xhigh', 'max'],
      speed: ['auto', 'normal', 'fast']
    })
    expect(canDisableLLMModelReasoning(provider, model)).toBe(true)
  })

  it.each([
    [LLMProviders.Anthropic, 'claude-haiku-5-5'],
    [LLMProviders.OpenRouter, 'anthropic/claude-haiku-5.5']
  ] as const)('exposes Haiku 5.5 capabilities for %s', (provider, model) => {
    const entry = getLLMModelCatalogEntry(provider, model)

    expect(entry).toMatchObject({
      supportsForcedToolChoice: true,
      supportsTemperature: false,
      reasoning: ['auto', 'none', 'low', 'medium', 'high', 'xhigh', 'max'],
      speed: provider === LLMProviders.Anthropic
        ? ['auto']
        : ['auto', 'normal', 'fast']
    })
    expect(entry?.inputMediaTypes).toContain('application/pdf')
    expect(canDisableLLMModelReasoning(provider, model)).toBe(true)

    if (provider === LLMProviders.Anthropic) {
      expect(entry?.defaultReasoningEffort).toBe('medium')
    }
  })
})
