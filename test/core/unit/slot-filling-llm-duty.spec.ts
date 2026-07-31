import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env['LEON_NODE_ENV'] = 'testing'
process.env['LEON_LLM'] = 'openai/gpt-5.4'

const coreMocks = vi.hoisted(() => ({
  llmProvider: {
    prompt: vi.fn()
  },
  llmManager: {
    coreLLMDuties: {
      'slot-filling': {
        maxTokens: 96,
        thoughtTokensBudget: 0,
        temperature: 0
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
  LLM_PROVIDER: coreMocks.llmProvider,
  LLM_MANAGER: coreMocks.llmManager
}))

let SlotFillingLLMDuty: typeof import('@/core/llm-manager/llm-duties/slot-filling-llm-duty').SlotFillingLLMDuty

beforeAll(async () => {
  ;({ SlotFillingLLMDuty } = await import(
    '@/core/llm-manager/llm-duties/slot-filling-llm-duty'
  ))
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SlotFillingLLMDuty', () => {
  it('returns a filled slot when the provider extracts one', async () => {
    coreMocks.llmProvider.prompt.mockResolvedValue({
      output: JSON.stringify({
        filled_slots: {
          duration: '3 secs'
        }
      }),
      usedInputTokens: 20,
      usedOutputTokens: 8
    })

    const duty = new SlotFillingLLMDuty({
      input: {
        slotName: 'duration',
        slotDescription: 'Timer duration',
        slotType: 'string',
        latestUtterance: '3 secs',
        recentUtterances: ['Set a timer', '3 secs']
      },
      startingUtterance: 'Set a timer'
    })

    await duty.init()
    const result = await duty.execute()

    expect(result?.output).toEqual({
      status: 'success',
      filled_slots: {
        duration: '3 secs'
      }
    })
  })

  it('returns not_found when no slot is extracted', async () => {
    coreMocks.llmProvider.prompt.mockResolvedValue({
      output: JSON.stringify({}),
      usedInputTokens: 12,
      usedOutputTokens: 3
    })

    const duty = new SlotFillingLLMDuty({
      input: {
        slotName: 'duration',
        slotDescription: 'Timer duration',
        slotType: 'string',
        latestUtterance: 'I do not know',
        recentUtterances: ['Set a timer', 'I do not know']
      },
      startingUtterance: 'Set a timer'
    })

    await duty.init()
    const result = await duty.execute()

    expect(result?.output).toEqual({
      status: 'not_found'
    })
  })
})
