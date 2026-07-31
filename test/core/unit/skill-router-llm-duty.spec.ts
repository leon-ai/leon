import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env['LEON_NODE_ENV'] = 'testing'
process.env['LEON_LLM'] = 'openai/gpt-5.4'

const coreMocks = vi.hoisted(() => ({
  llmProvider: {
    prompt: vi.fn()
  },
  llmManager: {
    skillListContent: 'timer_skill: Set timers',
    coreLLMDuties: {
      'skill-router': {
        maxTokens: 128,
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

let SkillRouterLLMDuty: typeof import('@/core/llm-manager/llm-duties/skill-router-llm-duty').SkillRouterLLMDuty

beforeAll(async () => {
  ;({ SkillRouterLLMDuty } = await import(
    '@/core/llm-manager/llm-duties/skill-router-llm-duty'
  ))
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SkillRouterLLMDuty', () => {
  it('returns the chosen skill from the provider result', async () => {
    const history = [
      {
        who: 'owner',
        message: 'Set a timer for me'
      }
    ]

    coreMocks.llmProvider.prompt.mockResolvedValue({
      output: 'timer_skill',
      usedInputTokens: 10,
      usedOutputTokens: 2
    })

    const duty = new SkillRouterLLMDuty({
      input: 'Set a timer for me',
      history
    })

    await duty.init()
    const result = await duty.execute()

    expect(result?.output).toBe('timer_skill')
    expect(coreMocks.llmProvider.prompt).toHaveBeenCalledWith(
      'User Query: "Set a timer for me"\nChosen Skill Name: ',
      expect.objectContaining({
        dutyType: 'skill-router',
        history,
        maxTokens: 128,
        temperature: 0,
        disableThinking: true
      })
    )
  })
})
