import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AgentCallableFunction,
  AgentToolCatalog
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-loop'
import {
  AGENT_CLARIFICATION_TOOL_NAME,
  AGENT_PLAN_TOOL_NAME,
  AGENT_SKILL_TOOL_NAME,
  AGENT_TOOLKIT_LOADER_NAME,
  AgentModelProviderError,
  buildAgentToolCatalog,
  runAgentLoop
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-loop'
import { findDuplicateToolInputMatch } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-helpers'
import {
  createAgentLoopContinuationState,
  isAgentLoopContinuationStateValid
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-loop-continuation'
import {
  buildBoundedToolObservation,
  prepareAgentModelContext
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-context-budget'
import {
  AGENT_MAX_ITERATIONS,
  AGENT_MAX_PARALLEL_TOOL_CALLS,
  AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME
} from '@/core/llm-manager/llm-duties/react-llm-duty/constants'
import type {
  AgentToolTranscriptMessage,
  OpenAIToolCall
} from '@/core/llm-manager/types'

const coreMocks = vi.hoisted(() => ({
  getFlattenedTools: vi.fn(),
  getToolFunctions: vi.fn(),
  resolveToolById: vi.fn()
}))

vi.mock('@/core', () => ({
  TOOLKIT_REGISTRY: {
    getFlattenedTools: coreMocks.getFlattenedTools,
    getToolFunctions: coreMocks.getToolFunctions,
    resolveToolById: coreMocks.resolveToolById
  }
}))

const CALLABLE_TOOL_NAME = 'test__lookup__run'

const callable: AgentCallableFunction = {
  qualifiedName: 'test.lookup.run',
  toolkitId: 'test',
  toolId: 'lookup',
  functionName: 'run',
  functionConfig: {
    description: 'Run a lookup.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' }
      },
      required: ['query'],
      additionalProperties: false
    }
  }
}

function createCatalog(): AgentToolCatalog {
  return {
    tools: [
      {
        type: 'function',
        function: {
          name: CALLABLE_TOOL_NAME,
          description: callable.functionConfig.description,
          parameters: callable.functionConfig.parameters
        }
      }
    ],
    functionsByToolName: new Map([[CALLABLE_TOOL_NAME, callable]]),
    availableToolkitsById: new Map(),
    loadedToolkitIds: new Set(['test'])
  }
}

function toolCall(
  id: string,
  name: string,
  args: Record<string, unknown>
): OpenAIToolCall {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args)
    }
  }
}

describe('continuous agent loop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coreMocks.getFlattenedTools.mockReturnValue([])
    coreMocks.resolveToolById.mockReturnValue(null)
    coreMocks.getToolFunctions.mockReturnValue(null)
  })

  it('uses a 32-iteration operational budget', () => {
    expect(AGENT_MAX_ITERATIONS).toBe(32)
  })

  it('keeps tool calls and results in one transcript until the final answer', async () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Find the answer.' }
    ]
    let modelTurn = 0

    const result = await runAgentLoop({
      transcript,
      catalog: createCatalog(),
      callModel: async (messages) => {
        modelTurn += 1
        if (modelTurn === 1) {
          return {
            toolCalls: [
              toolCall('call-1', CALLABLE_TOOL_NAME, { query: 'Leon' })
            ]
          }
        }

        expect(messages.at(-2)).toMatchObject({
          role: 'assistant',
          toolCalls: [
            {
              id: 'call-1',
              function: { name: CALLABLE_TOOL_NAME }
            }
          ]
        })
        expect(messages.at(-1)).toEqual({
          role: 'tool',
          toolCallId: 'call-1',
          toolName: CALLABLE_TOOL_NAME,
          content: 'Found Leon.'
        })
        return { textContent: 'Leon was found.' }
      },
      executeFunction: async () => ({
        execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'Found Leon.',
          requestedToolInput: JSON.stringify({ query: 'Leon' })
        }
      }),
      loadAgentSkill: async () => null
    })

    expect(result.intent).toBe('answer')
    expect(result.answer).toBe('Leon was found.')
    expect(result.executionHistory).toHaveLength(1)
    expect(result.transcript).toBe(transcript)
  })

  it('keeps visual files returned by a tool in the model transcript', async () => {
    let modelTurn = 0

    await runAgentLoop({
      transcript: [{ role: 'user', content: 'Inspect the screen.' }],
      catalog: createCatalog(),
      callModel: async (messages) => {
        modelTurn += 1
        if (modelTurn === 1) {
          return {
            toolCalls: [
              toolCall('capture-1', CALLABLE_TOOL_NAME, { query: 'screen' })
            ]
          }
        }

        expect(messages.at(-1)).toMatchObject({
          role: 'tool',
          toolCallId: 'capture-1',
          files: [
            {
              dataBase64: 'aW1hZ2U=',
              mediaType: 'image/png',
              visualDetail: 'high'
            }
          ]
        })
        return { textContent: 'The screen is visible.' }
      },
      executeFunction: async () => ({
        execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'Screen captured.'
        },
        modelFiles: [
          {
            dataBase64: 'aW1hZ2U=',
            mediaType: 'image/png',
            visualDetail: 'high'
          }
        ]
      }),
      loadAgentSkill: async () => null
    })
  })

  it('returns validation failures as observations so the model can recover', async () => {
    const executeFunction = vi.fn()
    let modelTurn = 0

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Run it.' }],
      catalog: createCatalog(),
      callModel: async (messages) => {
        modelTurn += 1
        if (modelTurn === 1) {
          return {
            toolCalls: [
              toolCall('invalid', CALLABLE_TOOL_NAME, { query: 42 })
            ]
          }
        }

        expect(messages.at(-1)).toMatchObject({
          role: 'tool',
          content: expect.stringContaining('does not match')
        })
        return { textContent: 'I could not run it with that input.' }
      },
      executeFunction,
      loadAgentSkill: async () => null
    })

    expect(executeFunction).not.toHaveBeenCalled()
    expect(result.intent).toBe('answer')
  })

  it('separates a generated title from executable tool arguments', async () => {
    const executeFunction = vi.fn(
      async (
        _callable: AgentCallableFunction,
        toolInput: string
      ) => ({
        execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'Desktop files listed.',
          requestedToolInput: toolInput
        }
      })
    )
    let modelTurn = 0

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'List my desktop files.' }],
      catalog: createCatalog(),
      callModel: async () => {
        modelTurn += 1
        if (modelTurn === 1) {
          return {
            toolCalls: [
              toolCall('list-desktop', CALLABLE_TOOL_NAME, {
                query: '~/Desktop',
                [AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME]:
                  'List files on ~/Desktop'
              })
            ]
          }
        }

        return { textContent: 'The desktop files were listed.' }
      },
      executeFunction,
      loadAgentSkill: async () => null
    })

    expect(executeFunction).toHaveBeenCalledWith(
      callable,
      JSON.stringify({ query: '~/Desktop' }),
      'List files on ~/Desktop'
    )
    expect(result.executionHistory[0]).toMatchObject({
      toolCallTitle: 'List files on ~/Desktop',
      requestedToolInput: JSON.stringify({ query: '~/Desktop' })
    })
  })

  it('compacts context and disables reasoning for one empty-output recovery', async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({ textContent: '' })
      .mockResolvedValueOnce({ textContent: 'Recovered answer.' })

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Finish this request.' }],
      catalog: createCatalog(),
      callModel,
      executeFunction: async () => {
        throw new Error('should not execute')
      },
      loadAgentSkill: async () => null
    })

    expect(callModel).toHaveBeenCalledTimes(2)
    expect(callModel.mock.calls[0]?.[2]).toEqual({
      isRecoveryAttempt: false
    })
    expect(callModel.mock.calls[1]?.[2]).toEqual({
      isRecoveryAttempt: true
    })
    expect(result.answer).toBe('Recovered answer.')
  })

  it('adds convergence guidance for the final eight operational iterations', async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [
          toolCall('before-convergence', CALLABLE_TOOL_NAME, { query: 'Leon' })
        ]
      })
      .mockResolvedValueOnce({ textContent: 'Converged answer.' })

    await runAgentLoop({
      transcript: [{ role: 'user', content: 'Finish this request.' }],
      catalog: createCatalog(),
      maxIterations: 9,
      callModel,
      executeFunction: async () => ({
        execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'Evidence collected.',
          requestedToolInput: JSON.stringify({ query: 'Leon' })
        }
      }),
      loadAgentSkill: async () => null
    })

    expect(callModel.mock.calls[0]?.[2]).toEqual({
      isRecoveryAttempt: false
    })
    expect(callModel.mock.calls[1]?.[2]).toEqual({
      isRecoveryAttempt: false,
      remainingIterations: 8
    })
  })

  it('retries one provider failure under context pressure', async () => {
    const callModel = vi
      .fn()
      .mockRejectedValueOnce(
        new AgentModelProviderError('Context pressure.', true)
      )
      .mockResolvedValueOnce({
        toolCalls: [
          toolCall('compact-context-tool', CALLABLE_TOOL_NAME, {
            query: 'Leon'
          })
        ]
      })
      .mockResolvedValueOnce({ textContent: 'Recovered from compact context.' })

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Finish this request.' }],
      catalog: createCatalog(),
      callModel,
      executeFunction: async () => ({
        execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'Compact evidence.',
          requestedToolInput: JSON.stringify({ query: 'Leon' })
        }
      }),
      loadAgentSkill: async () => null
    })

    expect(callModel.mock.calls[1]?.[2]).toEqual({
      isRecoveryAttempt: true,
      isContextRecoveryAttempt: true
    })
    expect(callModel.mock.calls[2]?.[2]).toEqual({
      isRecoveryAttempt: false,
      isContextRecoveryAttempt: true
    })
    expect(result.answer).toBe('Recovered from compact context.')
  })

  it('recovers before executing a truncated tool-call batch', async () => {
    const executeFunction = vi.fn()
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [
          toolCall('partial-call', CALLABLE_TOOL_NAME, { query: 'partial' })
        ],
        isTruncated: true
      })
      .mockResolvedValueOnce({ textContent: 'Recovered without partial work.' })

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Finish this request.' }],
      catalog: createCatalog(),
      callModel,
      executeFunction,
      loadAgentSkill: async () => null
    })

    expect(callModel).toHaveBeenCalledTimes(2)
    expect(callModel.mock.calls[1]?.[2]).toEqual({
      isRecoveryAttempt: true
    })
    expect(executeFunction).not.toHaveBeenCalled()
    expect(result.answer).toBe('Recovered without partial work.')
  })

  it('retries a truncated completion instead of returning partial text', async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        textContent: 'Partial answer',
        isTruncated: true
      })
      .mockResolvedValueOnce({ textContent: 'Complete answer.' })

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Explain it.' }],
      catalog: createCatalog(),
      callModel,
      executeFunction: async () => {
        throw new Error('should not execute')
      },
      loadAgentSkill: async () => null
    })

    expect(callModel).toHaveBeenCalledTimes(2)
    expect(result.answer).toBe('Complete answer.')
    expect(result.transcript).not.toContainEqual({
      role: 'assistant',
      content: 'Partial answer'
    })
  })

  it('pauses with the complete transcript when clarification is required', async () => {
    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Send it.' }],
      catalog: createCatalog(),
      callModel: async () => ({
        toolCalls: [
          toolCall('clarify-1', AGENT_CLARIFICATION_TOOL_NAME, {
            question: 'Which recipient should I use?'
          })
        ]
      }),
      executeFunction: async () => {
        throw new Error('should not execute')
      },
      loadAgentSkill: async () => null
    })

    expect(result).toMatchObject({
      intent: 'clarification',
      answer: 'Which recipient should I use?'
    })
    expect(result.transcript.at(-1)).toEqual({
      role: 'tool',
      toolCallId: 'clarify-1',
      toolName: AGENT_CLARIFICATION_TOOL_NAME,
      content: 'Clarification requested. Wait for the owner response.'
    })
  })

  it('uses a tools-restricted finalization checkpoint at the iteration limit', async () => {
    const callModel = vi.fn(async (messages, tools, options) => {
      if (!options.isFinalizationAttempt) {
        return {
          toolCalls: [
            toolCall('lookup-before-limit', CALLABLE_TOOL_NAME, {
              query: 'Leon'
            })
          ]
        }
      }

      expect(messages.at(-1)).toMatchObject({
        role: 'tool',
        content: 'Found enough evidence.'
      })
      expect(tools.map((tool) => tool.function.name)).toEqual([
        AGENT_CLARIFICATION_TOOL_NAME
      ])
      return { textContent: 'Here is the complete supported answer.' }
    })

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Find the answer.' }],
      catalog: createCatalog(),
      maxIterations: 1,
      callModel,
      executeFunction: async () => ({
        execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'Found enough evidence.',
          requestedToolInput: JSON.stringify({ query: 'Leon' })
        }
      }),
      loadAgentSkill: async () => null
    })

    expect(callModel).toHaveBeenCalledTimes(2)
    expect(callModel.mock.calls[1]?.[2]).toEqual({
      isRecoveryAttempt: false,
      isFinalizationAttempt: true
    })
    expect(result.intent).toBe('answer')
    expect(result.answer).toBe('Here is the complete supported answer.')
  })

  it('offers alternatives and saves a continuation when work is incomplete', async () => {
    const callModel = vi.fn(async (_messages, _tools, options) => {
      if (!options.isFinalizationAttempt) {
        return {
          toolCalls: [
            toolCall('lookup-before-pause', CALLABLE_TOOL_NAME, {
              query: 'Leon'
            })
          ]
        }
      }

      return {
        toolCalls: [
          toolCall('continue-after-limit', AGENT_CLARIFICATION_TOOL_NAME, {
            explanation: 'The remaining source could not be verified yet.',
            alternatives: [
              'Continue checking the remaining source.',
              'Answer from the verified evidence only.'
            ],
            question: 'May I continue from the saved state?'
          })
        ]
      }
    })

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Verify every source.' }],
      catalog: createCatalog(),
      maxIterations: 1,
      callModel,
      executeFunction: async () => ({
        execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'The first source is verified.',
          requestedToolInput: JSON.stringify({ query: 'Leon' })
        }
      }),
      loadAgentSkill: async () => null
    })

    expect(result.intent).toBe('clarification')
    expect(result.answer).toContain(
      'The remaining source could not be verified yet.'
    )
    expect(result.answer).toContain(
      '- Continue checking the remaining source.'
    )
    expect(result.answer).toContain('May I continue from the saved state?')
    expect(result.transcript.at(-1)).toMatchObject({
      role: 'tool',
      toolName: AGENT_CLARIFICATION_TOOL_NAME
    })
  })

  it('falls back to a resumable continuation when finalization fails', async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [
          toolCall('lookup-before-fallback', CALLABLE_TOOL_NAME, {
            query: 'Leon'
          })
        ]
      })
      .mockResolvedValueOnce(null)

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Finish this request.' }],
      catalog: createCatalog(),
      maxIterations: 1,
      callModel,
      executeFunction: async () => ({
        execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'Partial progress saved.',
          requestedToolInput: JSON.stringify({ query: 'Leon' })
        }
      }),
      loadAgentSkill: async () => null
    })

    expect(result.intent).toBe('clarification')
    expect(callModel).toHaveBeenCalledTimes(3)
    expect(result.answer).toContain('Finish this request.')
    expect(result.answer).toContain('Partial progress saved.')
    expect(result.answer).toContain(
      'Produce the final answer from the verified findings'
    )
    expect(result.answer).toContain('May I continue with that next step?')
  })

  it('retries failed finalization from a bounded evidence-only transcript', async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [
          toolCall('lookup-before-recovery', CALLABLE_TOOL_NAME, {
            query: 'Leon'
          })
        ]
      })
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async (messages, tools, options) => {
        expect(messages).toHaveLength(1)
        expect(messages[0]?.content).toContain('<original_owner_request>')
        expect(messages[0]?.content).toContain('Verified evidence.')
        expect(tools.map((tool) => tool.function.name)).toEqual([
          AGENT_CLARIFICATION_TOOL_NAME
        ])
        expect(options).toEqual({
          isRecoveryAttempt: true,
          isFinalizationAttempt: true,
          isContextRecoveryAttempt: true
        })
        return { textContent: 'Recovered evidence-based answer.' }
      })

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Finish this request.' }],
      catalog: createCatalog(),
      maxIterations: 1,
      callModel,
      executeFunction: async () => ({
        execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'Verified evidence.',
          requestedToolInput: JSON.stringify({ query: 'Leon' })
        }
      }),
      loadAgentSkill: async () => null
    })

    expect(result.intent).toBe('answer')
    expect(result.answer).toBe('Recovered evidence-based answer.')
  })

  it('rejects hallucinated operational tools during finalization', async () => {
    const executeFunction = vi.fn().mockResolvedValue({
      execution: {
        function: callable.qualifiedName,
        status: 'success',
        observation: 'Unexpected execution.',
        requestedToolInput: JSON.stringify({ query: 'Leon' })
      }
    })
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [
          toolCall('allowed-before-checkpoint', CALLABLE_TOOL_NAME, {
            query: 'Leon'
          })
        ]
      })
      .mockResolvedValueOnce({
        toolCalls: [
          toolCall('hallucinated-final-tool', CALLABLE_TOOL_NAME, {
            query: 'Leon'
          })
        ]
      })

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Finish this request.' }],
      catalog: createCatalog(),
      maxIterations: 1,
      callModel,
      executeFunction,
      loadAgentSkill: async () => null
    })

    expect(executeFunction).toHaveBeenCalledTimes(1)
    expect(callModel).toHaveBeenCalledTimes(3)
    expect(result.intent).toBe('clarification')
    expect(result.answer).toContain('Unexpected execution.')
    expect(result.answer).toContain('May I continue with that next step?')
  })

  it('builds context-recovery failure details from the saved run state', async () => {
    const callModel = vi
      .fn()
      .mockRejectedValueOnce(
        new AgentModelProviderError('Context pressure.', true)
      )
      .mockRejectedValueOnce(new Error('Provider still unavailable.'))

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Prepare the security report.' }],
      catalog: createCatalog(),
      initialExecutionHistory: [
        {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'TLS configuration verified.',
          stepLabel: 'Verify TLS'
        }
      ],
      initialTrackedSteps: [
        { label: 'Verify TLS', status: 'completed' },
        { label: 'Review unresolved findings', status: 'in_progress' }
      ],
      callModel,
      executeFunction: async () => {
        throw new Error('should not execute')
      },
      loadAgentSkill: async () => null
    })

    expect(result.intent).toBe('clarification')
    expect(result.answer).toContain('Prepare the security report.')
    expect(result.answer).toContain('TLS configuration verified.')
    expect(result.answer).toContain(
      'Review unresolved findings (in_progress)'
    )
    expect(result.answer).toContain(
      'Next, I will: Review unresolved findings.'
    )
  })

  it('honors direct tool handoffs for explicitly forced tools', async () => {
    const callModel = vi.fn().mockResolvedValue({
      toolCalls: [
        toolCall('terminal-1', CALLABLE_TOOL_NAME, { query: 'Leon' })
      ]
    })

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Run it.' }],
      catalog: createCatalog(),
      callModel,
      executeFunction: async () => ({
        execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'Done.',
          requestedToolInput: JSON.stringify({ query: 'Leon' })
        },
        handoffSignal: {
          intent: 'answer',
          draft: 'The tool completed the request.'
        }
      }),
      loadAgentSkill: async () => null,
      allowDirectAnswerHandoff: true
    })

    expect(callModel).toHaveBeenCalledOnce()
    expect(result.answer).toBe('The tool completed the request.')
    expect(result.intent).toBe('answer')
  })

  it('keeps ordinary tool answers as observations until the model finishes', async () => {
    let modelTurn = 0

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Complete both steps.' }],
      catalog: createCatalog(),
      callModel: async (messages) => {
        modelTurn += 1
        if (modelTurn === 1) {
          return {
            toolCalls: [
              toolCall('answer-1', CALLABLE_TOOL_NAME, { query: 'Leon' })
            ]
          }
        }

        expect(messages.at(-1)).toMatchObject({
          role: 'tool',
          content: 'First step complete.'
        })
        return { textContent: 'Both steps are complete.' }
      },
      executeFunction: async () => ({
        execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'First step complete.',
          requestedToolInput: JSON.stringify({ query: 'Leon' })
        },
        handoffSignal: {
          intent: 'answer',
          draft: 'First step complete.'
        }
      }),
      loadAgentSkill: async () => null
    })

    expect(modelTurn).toBe(2)
    expect(result.answer).toBe('Both steps are complete.')
  })

  it('limits parallel tool calls and continues without owner input', async () => {
    const executeFunction = vi.fn(async (_callable, toolInput: string) => ({
      execution: {
        function: callable.qualifiedName,
        status: 'success',
        observation: `Completed ${toolInput}.`,
        requestedToolInput: toolInput
      }
    }))
    let modelTurn = 0

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Run every lookup.' }],
      catalog: createCatalog(),
      callModel: async (messages) => {
        modelTurn += 1
        if (modelTurn === 1) {
          return {
            toolCalls: Array.from(
              { length: AGENT_MAX_PARALLEL_TOOL_CALLS + 4 },
              (_, index) =>
                toolCall(`lookup-${index}`, CALLABLE_TOOL_NAME, {
                  query: `query-${index}`
                })
            )
          }
        }

        const assistantCall = messages.findLast(
          (message) => message.role === 'assistant' && message.toolCalls
        )
        expect(assistantCall?.toolCalls).toHaveLength(
          AGENT_MAX_PARALLEL_TOOL_CALLS
        )
        expect(assistantCall?.content).toContain('deferred 4')
        return { textContent: 'The retained batch is complete.' }
      },
      executeFunction,
      loadAgentSkill: async () => null
    })

    expect(executeFunction).toHaveBeenCalledTimes(
      AGENT_MAX_PARALLEL_TOOL_CALLS
    )
    expect(modelTurn).toBe(2)
    expect(result.answer).toBe('The retained batch is complete.')
  })

  it('keeps optional plans and Agent Skills inside the same loop', async () => {
    const onPlanUpdated = vi.fn()
    const onAgentSkillLoaded = vi.fn()
    let modelTurn = 0

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Complete the workflow.' }],
      catalog: createCatalog(),
      callModel: async () => {
        modelTurn += 1
        if (modelTurn === 1) {
          return {
            toolCalls: [
              toolCall('plan-1', AGENT_PLAN_TOOL_NAME, {
                steps: [
                  { label: 'Inspect source', status: 'in_progress' }
                ]
              })
            ]
          }
        }
        if (modelTurn === 2) {
          return {
            toolCalls: [
              toolCall('skill-1', AGENT_SKILL_TOOL_NAME, {
                skill_id: 'video-inspection'
              })
            ]
          }
        }
        return { textContent: 'Workflow complete.' }
      },
      executeFunction: async () => {
        throw new Error('should not execute')
      },
      loadAgentSkill: async () => ({
        id: 'video-inspection',
        name: 'Video Inspection',
        description: 'Inspect a source video.',
        rootPath: '/tmp/video-inspection',
        skillPath: '/tmp/video-inspection/SKILL.md',
        instructions: 'Inspect the direct source first.'
      }),
      onPlanUpdated,
      onAgentSkillLoaded
    })

    expect(onPlanUpdated).toHaveBeenCalledWith([
      { label: 'Inspect source', status: 'in_progress' }
    ])
    expect(onAgentSkillLoaded).toHaveBeenCalledOnce()
    expect(result.answer).toBe('Workflow complete.')
  })

  it('blocks an identical tool call and reuses its prior observation', async () => {
    const executeFunction = vi.fn().mockResolvedValue({
      execution: {
        function: callable.qualifiedName,
        status: 'success',
        observation: 'Found once.',
        requestedToolInput: JSON.stringify({ query: 'Leon' })
      }
    })
    let modelTurn = 0

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Find Leon.' }],
      catalog: createCatalog(),
      callModel: async (messages) => {
        modelTurn += 1
        if (modelTurn <= 2) {
          return {
            toolCalls: [
              toolCall(`lookup-${modelTurn}`, CALLABLE_TOOL_NAME, {
                query: 'Leon'
              })
            ]
          }
        }

        expect(messages.at(-1)).toMatchObject({
          role: 'tool',
          content: expect.stringContaining('Duplicate call blocked')
        })
        return { textContent: 'I reused the first result.' }
      },
      executeFunction,
      loadAgentSkill: async () => null
    })

    expect(executeFunction).toHaveBeenCalledOnce()
    expect(result.answer).toBe('I reused the first result.')
  })

  it('allows repeated successful calls when deduplication is disabled', async () => {
    const repeatableCallable: AgentCallableFunction = {
      ...callable,
      functionConfig: {
        ...callable.functionConfig,
        deduplicate_calls: false
      }
    }
    const repeatableCatalog: AgentToolCatalog = {
      ...createCatalog(),
      functionsByToolName: new Map([
        [CALLABLE_TOOL_NAME, repeatableCallable]
      ])
    }
    const executeFunction = vi.fn().mockResolvedValue({
      execution: {
        function: repeatableCallable.qualifiedName,
        status: 'success',
        observation: 'Current state.',
        requestedToolInput: JSON.stringify({ query: 'Leon' })
      }
    })
    let modelTurn = 0

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Refresh the state twice.' }],
      catalog: repeatableCatalog,
      callModel: async () => {
        modelTurn += 1
        if (modelTurn <= 2) {
          return {
            toolCalls: [
              toolCall(`lookup-${modelTurn}`, CALLABLE_TOOL_NAME, {
                query: 'Leon'
              })
            ]
          }
        }
        return { textContent: 'Both state reads completed.' }
      },
      executeFunction,
      loadAgentSkill: async () => null
    })

    expect(executeFunction).toHaveBeenCalledTimes(2)
    expect(result.answer).toBe('Both state reads completed.')
  })

  it('blocks overlapping reads of the same tool artifact', () => {
    const previousInput = JSON.stringify({
      outputLogPath: '/tmp/tool-output.log',
      options: { maxChars: 3_000 }
    })
    const candidateInput = JSON.stringify({
      outputLogPath: '/tmp/tool-output.log',
      options: { maxChars: 5_000 }
    })

    expect(
      findDuplicateToolInputMatch(
        [
          {
            function: 'operating_system_control.file.readToolArtifact',
            status: 'success',
            observation: 'Artifact prefix read.',
            requestedToolInput: previousInput
          }
        ],
        'operating_system_control.file.readToolArtifact',
        'Read artifact',
        candidateInput
      )
    ).toMatchObject({ stepNumber: 1 })
  })

  it('allows an identical retry after a failed tool execution', () => {
    const toolInput = JSON.stringify({ level: 35 })

    expect(
      findDuplicateToolInputMatch(
        [
          {
            function: 'device_control.display.set_volume',
            status: 'error',
            observation: 'Transient failure.',
            requestedToolInput: toolInput
          }
        ],
        'device_control.display.set_volume',
        'Set volume',
        toolInput
      )
    ).toBeNull()
  })

  it('restores execution and plan state after clarification', async () => {
    const executeFunction = vi.fn()
    const priorExecution = {
      function: callable.qualifiedName,
      status: 'success' as const,
      observation: 'Found before clarification.',
      requestedToolInput: JSON.stringify({ query: 'Leon' })
    }
    const initialTrackedSteps = [
      { label: 'Confirm recipient', status: 'in_progress' as const }
    ]
    let modelTurn = 0

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'The recipient is Louis.' }],
      catalog: createCatalog(),
      initialExecutionHistory: [priorExecution],
      initialTrackedSteps,
      callModel: async (messages) => {
        modelTurn += 1
        if (modelTurn === 1) {
          return {
            toolCalls: [
              toolCall('resumed-lookup', CALLABLE_TOOL_NAME, {
                query: 'Leon'
              })
            ]
          }
        }

        expect(messages.at(-1)).toMatchObject({
          role: 'tool',
          content: expect.stringContaining('Duplicate call blocked')
        })
        return { textContent: 'I continued from the saved state.' }
      },
      executeFunction,
      loadAgentSkill: async () => null
    })

    expect(executeFunction).not.toHaveBeenCalled()
    expect(result.executionHistory).toEqual([priorExecution])
    expect(result.trackedSteps).toEqual(initialTrackedSteps)
  })

  it('loads toolkit schemas and context progressively', async () => {
    coreMocks.getFlattenedTools.mockReturnValue([
      {
        toolkitId: 'video_streaming',
        toolkitName: 'Video Streaming',
        toolkitDescription: 'Inspect online video sources.',
        toolId: 'ytdlp',
        toolName: 'yt-dlp',
        toolDescription: 'Download video metadata and subtitles.'
      }
    ])
    coreMocks.getToolFunctions.mockReturnValue({
      downloadSubtitles: {
        description: 'Download subtitles from a video source.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' }
          },
          required: ['url'],
          additionalProperties: false
        }
      }
    })

    const catalog = buildAgentToolCatalog()
    expect(catalog.tools.map((tool) => tool.function.name)).toContain(
      AGENT_TOOLKIT_LOADER_NAME
    )
    let modelTurn = 0

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Understand this video.' }],
      catalog,
      callModel: async (messages, tools) => {
        modelTurn += 1
        if (modelTurn === 1) {
          return {
            toolCalls: [
              toolCall('load-video', AGENT_TOOLKIT_LOADER_NAME, {
                toolkit_id: 'video_streaming'
              })
            ]
          }
        }

        expect(tools.map((tool) => tool.function.name)).toContain(
          'video_streaming__ytdlp__downloadSubtitles'
        )
        expect(messages.at(-1)).toMatchObject({
          role: 'tool',
          content: expect.stringContaining('Direct-source guidance')
        })
        return { textContent: 'The video toolkit is ready.' }
      },
      executeFunction: async () => {
        throw new Error('should not execute')
      },
      loadToolkitContext: () => 'Direct-source guidance: inspect subtitles first.',
      loadAgentSkill: async () => null
    })

    expect(result.intent).toBe('answer')
    expect(catalog.loadedToolkitIds).toEqual(new Set(['video_streaming']))
  })

  it('loads every available toolkit schema eagerly without a discovery tool', () => {
    coreMocks.getFlattenedTools.mockReturnValue([
      {
        toolkitId: 'device_control',
        toolkitName: 'Device Control',
        toolkitDescription: 'Control a connected device.',
        toolId: 'robot',
        toolName: 'Robot',
        toolDescription: 'Control robot positioning.'
      }
    ])
    const parameters = {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
    coreMocks.getToolFunctions.mockReturnValue({
      home: {
        description: 'Return the robot to its home position.',
        parameters
      }
    })

    const catalog = buildAgentToolCatalog(null, [], false)
    const toolNames = catalog.tools.map((tool) => tool.function.name)

    expect(toolNames).not.toContain(AGENT_TOOLKIT_LOADER_NAME)
    expect(toolNames).toContain('device_control__robot__home')
    expect(catalog.loadedToolkitIds).toEqual(new Set(['device_control']))

    const homeTool = catalog.tools.find(
      (tool) => tool.function.name === 'device_control__robot__home'
    )
    expect(homeTool?.function.parameters).toMatchObject({
      properties: {
        [AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME]: {
          type: 'string'
        }
      },
      required: [AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME]
    })
    expect(parameters).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false
    })
  })

  it('bounds large observations and prunes inactive schemas near the context limit', () => {
    const largeObservation = buildBoundedToolObservation({
      status: 'success',
      message: 'Subtitles loaded.',
      output_log_path: '/tmp/tool-output.log',
      data: { output: 'subtitle '.repeat(2_000) }
    })
    expect(largeObservation.length).toBeLessThanOrEqual(6_000)
    expect(largeObservation).toContain('/tmp/tool-output.log')

    const oldToolkitTool = {
      type: 'function' as const,
      function: {
        name: 'video__download__run',
        description: 'Download a video.',
        parameters: { type: 'object' }
      }
    }
    const recentToolkitTool = {
      type: 'function' as const,
      function: {
        name: 'filesystem__read__run',
        description: 'Read a file.',
        parameters: { type: 'object' }
      }
    }
    const loaderTool = {
      type: 'function' as const,
      function: {
        name: AGENT_TOOLKIT_LOADER_NAME,
        description: 'Load a toolkit.',
        parameters: { type: 'object' }
      }
    }
    const context = prepareAgentModelContext({
      transcript: [
        { role: 'user', content: 'Inspect the subtitles.' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            toolCall('read-1', recentToolkitTool.function.name, {
              path: '/tmp/subtitles.srt'
            })
          ]
        },
        {
          role: 'tool',
          toolCallId: 'read-1',
          toolName: recentToolkitTool.function.name,
          content: largeObservation
        }
      ],
      systemPrompt: 'Use tools.',
      tools: [loaderTool, oldToolkitTool, recentToolkitTool],
      compactionTriggerTokens: 1,
      forceCompaction: true
    })

    expect(context.wasCompacted).toBe(true)
    expect(context.tools).toEqual([loaderTool, recentToolkitTool])
    expect(context.transcript.at(-1)).toMatchObject({
      role: 'assistant',
      content: expect.stringContaining(
        'earlier_completed_tool_exchange_compacted'
      )
    })
    expect(context.transcript.at(-1)?.content).toContain(
      '/tmp/tool-output.log'
    )
  })

  it('restores loaded toolkit schemas after clarification', () => {
    coreMocks.getFlattenedTools.mockReturnValue([
      {
        toolkitId: 'video_streaming',
        toolkitName: 'Video Streaming',
        toolkitDescription: 'Inspect online video sources.',
        toolId: 'ytdlp',
        toolName: 'yt-dlp',
        toolDescription: 'Download video metadata and subtitles.'
      }
    ])
    coreMocks.getToolFunctions.mockReturnValue({
      downloadSubtitles: {
        description: 'Download subtitles from a video source.',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url'],
          additionalProperties: false
        }
      }
    })

    const catalog = buildAgentToolCatalog(null, ['video_streaming'])

    expect(catalog.loadedToolkitIds).toEqual(new Set(['video_streaming']))
    expect(catalog.tools.map((tool) => tool.function.name)).toContain(
      'video_streaming__ytdlp__downloadSubtitles'
    )
  })

  it('persists a resumable transcript with a bounded lifetime', () => {
    const state = createAgentLoopContinuationState({
      originalInput: 'Send the message.',
      clarificationQuestion: 'Which recipient?',
      planWidgetId: 'plan-1',
      trackedSteps: [{ label: 'Send message', status: 'in_progress' }],
      executionHistory: [
        {
          function: callable.qualifiedName,
          status: 'success',
          observation: 'Recipient lookup complete.'
        }
      ],
      loadedToolkitIds: ['communication']
    })

    expect(isAgentLoopContinuationStateValid(state)).toBe(true)
    expect(state.transcript).not.toBe(undefined)
    expect(state.executionHistory).toHaveLength(1)
    expect(state.loadedToolkitIds).toEqual(['communication'])
    expect(state.transcript).toHaveLength(1)
    expect(state.transcript[0]?.content).toContain(
      'Recipient lookup complete.'
    )
    expect(state.transcript[0]?.content).not.toContain('Which recipient?')
  })

  it('keeps continuation checkpoints bounded after large runs', () => {
    const executionHistory = Array.from({ length: 100 }, (_, index) => ({
      function: callable.qualifiedName,
      status: 'success',
      observation: `Evidence ${index}: ${'detail '.repeat(500)}`
    }))
    const state = createAgentLoopContinuationState({
      originalInput: 'Complete the investigation.',
      clarificationQuestion: 'May I continue?',
      planWidgetId: 'plan-1',
      trackedSteps: [],
      executionHistory,
      loadedToolkitIds: ['test']
    })

    expect(state.transcript).toHaveLength(1)
    expect(state.transcript[0]?.content.length).toBeLessThan(9_000)
    expect(state.transcript[0]?.content).toContain('Evidence 99')
    expect(state.transcript[0]?.content).not.toContain('Evidence 0')
  })
})
