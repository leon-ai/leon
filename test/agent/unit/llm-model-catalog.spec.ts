import { describe, expect, it } from 'vitest'

import {
  LLM_MODEL_CATALOG,
  LLM_MODEL_REASONING_VALUES,
  LLM_MODEL_SPEED_VALUES
} from '@/core/llm-manager/llm-model-catalog'
import { LLMProviders } from '@/core/llm-manager/types'
import { getPublicModelCatalog } from '@/core/llm-manager/public-model-catalog'
import {
  LOCAL_LLM_CONTEXT_WINDOW_TOKENS,
  resolveModelContextWindowTokens
} from '@/core/llm-manager/model-context-windows'

describe('LLM model catalog', () => {
  it('exposes installed local filenames without assuming model-specific inference controls', () => {
    expect(getPublicModelCatalog().some((provider) => provider.id === 'llamacpp')).toBe(false)
    const local = getPublicModelCatalog(['example.gguf']).find((provider) => provider.id === 'llamacpp')

    expect(local).toMatchObject({
      label: 'llama.cpp', models: [{
        model: 'example.gguf', label: 'example', reasoning: ['auto'], speed: ['auto']
      }]
    })
  })

  it('resolves known capacities without assigning a default to independently hosted models', () => {
    expect(resolveModelContextWindowTokens(LLMProviders.OpenAI, 'gpt-6.1-sol'))
      .toBe(1_050_000)
    expect(resolveModelContextWindowTokens(LLMProviders.MiniMax, 'MiniMax-M3'))
      .toBe(1_000_000)
    expect(resolveModelContextWindowTokens(LLMProviders.OpenRouter, 'minimax/minimax-m3.1-flash:free'))
      .toBe(1_000_000)
    expect(resolveModelContextWindowTokens(LLMProviders.OpenRouter, 'deepseek/deepseek-v4.1-flash-1017'))
      .toBe(1_048_576)
    expect(resolveModelContextWindowTokens(LLMProviders.LlamaCPP, 'local.gguf'))
      .toBe(LOCAL_LLM_CONTEXT_WINDOW_TOKENS)
    expect(resolveModelContextWindowTokens(LLMProviders.SGLang, 'custom-model'))
      .toBeUndefined()
    expect(resolveModelContextWindowTokens(LLMProviders.OpenAI, 'custom-model'))
      .toBeUndefined()
  })

  it('exposes every cataloged provider with unique models and supported controls', () => {
    const targetKeys = LLM_MODEL_CATALOG.map(
      (entry) => `${entry.provider}/${entry.model}`
    )

    expect(new Set(targetKeys).size).toBe(targetKeys.length)
    expect(new Set(getPublicModelCatalog().map((provider) => provider.id)))
      .toEqual(new Set(LLM_MODEL_CATALOG.map((entry) => entry.provider)))

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
})
