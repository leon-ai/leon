import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env['LEON_NODE_ENV'] = 'testing'
process.env['LEON_LLM'] = 'openai/gpt-5.4'

const coreMocks = vi.hoisted(() => ({
  eventEmitter: {
    on: vi.fn()
  },
  persona: {
    getDutySystemPrompt: vi.fn((prompt: string) => `persona:${prompt}`)
  },
  llmProvider: {
    prompt: vi.fn(),
    consumeLastProviderErrorMessage: vi.fn(() => null)
  },
  llmManager: {
    coreLLMDuties: {
      paraphrase: {
        maxTokens: 192,
        thoughtTokensBudget: 0,
        temperature: 0.6
      }
    }
  }
}))

vi.mock('@/helpers/log-helper', () => ({
  LogHelper: {
    title: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/core', () => ({
  EVENT_EMITTER: coreMocks.eventEmitter,
  PERSONA: coreMocks.persona,
  LLM_PROVIDER: coreMocks.llmProvider,
  LLM_MANAGER: coreMocks.llmManager
}))

let ParaphraseLLMDuty: typeof import('@/core/llm-manager/llm-duties/paraphrase-llm-duty').ParaphraseLLMDuty

beforeAll(async () => {
  ;({ ParaphraseLLMDuty } = await import(
    '@/core/llm-manager/llm-duties/paraphrase-llm-duty'
  ))
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ParaphraseLLMDuty', () => {
  it('returns the provider paraphrase output', async () => {
    coreMocks.llmProvider.prompt.mockResolvedValue({
      output: 'I included your items in the shopping list.',
      usedInputTokens: 12,
      usedOutputTokens: 9
    })

    const duty = new ParaphraseLLMDuty({
      input: 'I added your items to the shopping list.'
    })

    await duty.init()
    const result = await duty.execute()

    expect(result?.output).toBe('I included your items in the shopping list.')
    expect(coreMocks.persona.getDutySystemPrompt).toHaveBeenCalled()
  })
})
