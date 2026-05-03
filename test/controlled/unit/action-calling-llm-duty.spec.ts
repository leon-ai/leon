import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env['LEON_NODE_ENV'] = 'testing'
process.env['LEON_LLM'] = 'openai/gpt-5.4'

const coreMocks = vi.hoisted(() => ({
  llmProvider: {
    prompt: vi.fn()
  },
  llmManager: {
    coreLLMDuties: {
      'action-calling': {
        maxTokens: 384,
        thoughtTokensBudget: 0,
        temperature: 0.1
      }
    }
  }
}))

const skillHelperMocks = vi.hoisted(() => ({
  getNewSkillConfig: vi.fn()
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

vi.mock('@/helpers/skill-domain-helper', () => ({
  SkillDomainHelper: skillHelperMocks
}))

let ActionCallingLLMDuty: typeof import('@/core/llm-manager/llm-duties/action-calling-llm-duty').ActionCallingLLMDuty

beforeAll(async () => {
  ;({ ActionCallingLLMDuty } = await import(
    '@/core/llm-manager/llm-duties/action-calling-llm-duty'
  ))
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ActionCallingLLMDuty', () => {
  it('uses tool calls to return a successful action selection', async () => {
    skillHelperMocks.getNewSkillConfig.mockResolvedValue({
      actions: {
        set_timer: {
          type: 'logic',
          description: 'Set a timer.',
          parameters: {
            duration: {
              type: 'string',
              description: 'Timer duration.'
            }
          }
        }
      },
      workflow: []
    })

    coreMocks.llmProvider.prompt.mockResolvedValue({
      output: '',
      toolCalls: [
        {
          id: 'tool_1',
          type: 'function',
          function: {
            name: 'set_timer',
            arguments: JSON.stringify({
              duration: '3 seconds'
            })
          }
        }
      ],
      usedInputTokens: 10,
      usedOutputTokens: 4
    })

    const duty = new ActionCallingLLMDuty({
      input: 'Set a timer for 3 seconds',
      skillName: 'timer_skill',
      workflowContext: {
        recentUtterances: [],
        recentActionArguments: [],
        collectedParameters: {},
        recentEntities: []
      }
    })

    await duty.init()
    const result = await duty.execute()
    const parsedOutput = JSON.parse(String(result?.output))

    expect(parsedOutput).toEqual([
      {
        status: 'success',
        name: 'set_timer',
        arguments: {
          duration: '3 seconds'
        }
      }
    ])
  })

  it('short-circuits when the skill workflow starts with a parameterless action', async () => {
    skillHelperMocks.getNewSkillConfig.mockResolvedValue({
      actions: {
        set_up: {
          type: 'dialog',
          description: 'Set up the game.'
        },
        play: {
          type: 'logic',
          description: 'Play.'
        }
      },
      workflow: ['set_up', 'play']
    })

    const duty = new ActionCallingLLMDuty({
      input: 'Play rock paper scissors',
      skillName: 'rochambeau_skill'
    })

    await duty.init()
    const result = await duty.execute()
    const parsedOutput = JSON.parse(String(result?.output))

    expect(coreMocks.llmProvider.prompt).not.toHaveBeenCalled()
    expect(parsedOutput).toEqual([
      {
        status: 'success',
        name: 'set_up',
        arguments: {}
      }
    ])
  })
})
