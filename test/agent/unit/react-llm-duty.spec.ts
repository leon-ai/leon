import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AgentCallableFunction,
  AgentToolCatalog,
  AgentLoopParams
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-loop'
import {
  AGENT_CLARIFICATION_TOOL_NAME,
  AGENT_PLAN_TOOL_NAME,
  AGENT_SKILL_TOOL_NAME,
  AGENT_TOOLKIT_LOADER_NAME,
  AGENT_SYSTEM_PROMPT,
  AgentModelProviderError,
  buildAgentProgressiveGuidanceSystemPrompt,
  buildAgentToolCatalog,
  evaluateAgentToolkitPreloadCost,
  findHighConfidenceAgentToolkitId,
  runAgentLoop as runAgentLoopWithCompletionReview
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-loop'
import { parseAgentPlan, isAgentPlanComplete } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-plan'
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
    loadedToolkitIds: new Set(['test']),
    loadedProgressiveGuidance: new Map()
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

// Existing protocol tests assume their final answers have passed review.
// Completion-specific tests below exercise the unwrapped loop and reviewer.
function runAgentLoop(params: AgentLoopParams): ReturnType<typeof runAgentLoopWithCompletionReview> {
  return runAgentLoopWithCompletionReview({
    ...params,
    callModel: (messages, tools, options, state) => options.isCompletionReview
      ? Promise.resolve({ textContent: JSON.stringify({ status: 'complete', reason: 'The fixture task is complete.' }) })
      : params.callModel(messages, tools, options, state)
  })
}

describe('continuous agent loop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coreMocks.getFlattenedTools.mockReturnValue([])
    coreMocks.resolveToolById.mockReturnValue(null)
    coreMocks.getToolFunctions.mockReturnValue(null)
  })

  it('retains provider reasoning through tool exchanges and continuation', async () => {
    const reasoning = 'The lookup is needed to answer the question.'
    const callModel = vi.fn()
      .mockResolvedValueOnce({ reasoning, toolCalls: [toolCall('lookup', CALLABLE_TOOL_NAME, { query: 'weather' })] })
      .mockImplementationOnce(async (messages) => {
        expect(messages).toContainEqual(expect.objectContaining({ role: 'assistant', reasoning }))
        return { textContent: 'It is sunny.', reasoning: 'The lookup confirms sunny weather.' }
      })
    const prepareContinuation = vi.fn(async (state) => structuredClone(state.transcript))
    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Check the weather.' }],
      catalog: createCatalog(), callModel, prepareContinuation,
      maxIterations: 2, finishingIterations: 1,
      executeFunction: async () => ({ execution: {
        function: callable.qualifiedName, status: 'success', observation: 'Sunny.'
      } }),
      loadAgentSkill: async () => null
    })
    expect(prepareContinuation).toHaveBeenCalledOnce()
    expect(result.transcript.at(-1)).toMatchObject({
      role: 'assistant', content: 'It is sunny.', reasoning: 'The lookup confirms sunny weather.'
    })
  })

  it('emits tool-accompanying progress and retains collection details through continuation', async () => {
    const steps = [{ label: 'Retrieve requested documents', status: 'in_progress',
      details: 'Verified item A; next list page 2. Enumeration is not complete.' }]
    const onProgressMessage = vi.fn()
    const prepareContinuation = vi.fn(async (state) => {
      expect(state.trackedSteps).toEqual(steps)
      return state.transcript
    })
    const result = await runAgentLoopWithCompletionReview({
      transcript: [{ role: 'user', content: 'Retrieve all documents.' }], catalog: createCatalog(),
      maxIterations: 2, finishingIterations: 1, prepareContinuation, onProgressMessage,
      callModel: vi.fn()
        .mockResolvedValueOnce({ textContent: 'Item A is verified. I am checking the next page.',
          toolCalls: [toolCall('plan', AGENT_PLAN_TOOL_NAME, { steps })] })
        .mockResolvedValueOnce({ textContent: 'The next page is unavailable.' })
        .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'blocked', reason: 'The service is offline.' }) }),
      executeFunction: vi.fn(), loadAgentSkill: async () => null
    })
    expect(onProgressMessage).toHaveBeenCalledExactlyOnceWith('Item A is verified. I am checking the next page.')
    expect(prepareContinuation).toHaveBeenCalledOnce()
    expect(result.trackedSteps).toEqual(steps)
    expect(result.transcript).toContainEqual(expect.objectContaining({
      role: 'assistant', content: 'Item A is verified. I am checking the next page.'
    }))
  })

  it('continues an incomplete invoice answer without replaying the downloaded item', async () => {
    const initialExecutionHistory = [{
      function: callable.qualifiedName, status: 'success',
      observation: 'Verified invoice-0003.pdf. Other requested invoices remain.',
      requestedToolInput: JSON.stringify({ query: 'invoice-0003' })
    }]
    const callModel = vi.fn()
      .mockResolvedValueOnce({ textContent: 'I downloaded one invoice. The remaining invoices are not downloaded yet.' })
      .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'continue', reason: 'Invoice 0003 is verified. Download the remaining August and September invoices.' }) })
      .mockResolvedValueOnce({ toolCalls: [toolCall('remaining', CALLABLE_TOOL_NAME, { query: 'remaining-invoices' })] })
      .mockResolvedValueOnce({ textContent: 'All requested invoices are downloaded and verified.' })
      .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'complete', reason: 'All requested invoices have verified files.' }) })
    const executeFunction = vi.fn(async () => ({ execution: {
      function: callable.qualifiedName, status: 'success',
      observation: 'Remaining August and September invoice files verified.',
      requestedToolInput: JSON.stringify({ query: 'remaining-invoices' })
    } }))
    const result = await runAgentLoopWithCompletionReview({
      transcript: [{ role: 'user', content: 'Download all August and September invoices.' }],
      catalog: createCatalog(), initialExecutionHistory, callModel, executeFunction,
      loadAgentSkill: async () => null
    })
    expect(result.intent).toBe('answer')
    expect(result.answer).toBe('All requested invoices are downloaded and verified.')
    expect(executeFunction).toHaveBeenCalledExactlyOnceWith(callable, JSON.stringify({ query: 'remaining-invoices' }), undefined)
    expect(callModel.mock.calls[1]?.[1]).toEqual([])
    expect(callModel.mock.calls[1]?.[2]).toMatchObject({ isCompletionReview: true })
    expect(callModel.mock.calls[2]?.[2]).toMatchObject({ requiresToolAction: true })
    expect(callModel.mock.calls[3]?.[2]).not.toHaveProperty('requiresToolAction')
    expect(JSON.stringify(callModel.mock.calls[2]?.[0])).toContain('Invoice 0003 is verified')
  })

  it('returns a genuine blocker without replaying input', async () => {
    const executeFunction = vi.fn()
    const result = await runAgentLoopWithCompletionReview({
      transcript: [{ role: 'user', content: 'Retrieve the documents.' }],
      catalog: createCatalog(),
      initialExecutionHistory: [{ function: callable.qualifiedName, status: 'error', observation: 'The document service is unavailable.' }],
      callModel: vi.fn()
        .mockResolvedValueOnce({ textContent: 'The document service is unavailable.' })
        .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'blocked', reason: 'The service is offline and no accessible copy exists.' }) }),
      executeFunction, loadAgentSkill: async () => null
    })
    expect(result.intent).toBe('blocked')
    expect(executeFunction).not.toHaveBeenCalled()
  })

  it('preserves unfinished work at the hard limit instead of returning a successful answer', async () => {
    const callModel = vi.fn()
      .mockResolvedValueOnce({ toolCalls: [toolCall('first', CALLABLE_TOOL_NAME, { query: 'first-item' })] })
      .mockResolvedValueOnce({ textContent: 'Only one requested file is downloaded.' })
      .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'continue', reason: 'The remaining requested files have not been downloaded.' }) })
    const result = await runAgentLoopWithCompletionReview({
      transcript: [{ role: 'user', content: 'Download all requested files.' }], catalog: createCatalog(),
      maxIterations: 1, callModel,
      executeFunction: vi.fn(async () => ({ execution: {
        function: callable.qualifiedName, status: 'success', observation: 'First file exists; others remain.'
      } })), loadAgentSkill: async () => null
    })
    expect(result.intent).toBe('blocked')
    expect(result.answer).toBe('The remaining requested files have not been downloaded.')
    expect(result.executionHistory).toHaveLength(1)
    expect(JSON.parse(callModel.mock.calls[2]?.[0].at(-1).content)).toMatchObject({ remaining_operational_iterations: 0 })
  })

  it.each([
    null,
    { textContent: 'not valid JSON' },
    { textContent: '{"status":"complete","reason":"ok"}', isTruncated: true },
    { toolCalls: [toolCall('unexpected', CALLABLE_TOOL_NAME, { query: 'unexpected' })] }
  ])('does not accept an unavailable or invalid completion review: %j', async (review) => {
    const executeFunction = vi.fn()
    const result = await runAgentLoopWithCompletionReview({
      transcript: [{ role: 'user', content: 'Do the task.' }], catalog: createCatalog(),
      initialExecutionHistory: [{ function: callable.qualifiedName, status: 'success', observation: 'Evidence.' }],
      callModel: vi.fn().mockResolvedValueOnce({ textContent: 'Done.' }).mockResolvedValueOnce(review),
      executeFunction, loadAgentSkill: async () => null
    })
    expect(result.intent).toBe('error')
    expect(result.answer).toContain('completion check failed')
    expect(executeFunction).not.toHaveBeenCalled()
  })

  it('checks unfinished plans and enters the finishing pass after rejected completion', async () => {
    const prepareContinuation = vi.fn(async (state) => state.transcript)
    const callModel = vi.fn()
      .mockResolvedValueOnce({ textContent: 'Done.' })
      .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'complete', reason: 'The task is complete.' }) })
      .mockResolvedValueOnce({ toolCalls: [toolCall('finish-plan', AGENT_PLAN_TOOL_NAME, {
        steps: [{ label: 'Verify the files', status: 'completed' }]
      })] })
      .mockResolvedValueOnce({ textContent: 'Files verified.' })
      .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'complete', reason: 'Files and plan verified.' }) })
    const result = await runAgentLoopWithCompletionReview({
      transcript: [{ role: 'user', content: 'Verify the files.' }], catalog: createCatalog(),
      initialTrackedSteps: [{ label: 'Verify the files', status: 'pending' }],
      maxIterations: 3, finishingIterations: 2, callModel, prepareContinuation,
      executeFunction: vi.fn(), loadAgentSkill: async () => null
    })
    expect(prepareContinuation).toHaveBeenCalledOnce()
    expect(JSON.parse(callModel.mock.calls[1]?.[0].at(-1).content)).toMatchObject({
      remaining_operational_iterations: 2
    })
    expect(JSON.parse(callModel.mock.calls[4]?.[0].at(-1).content)).toMatchObject({
      remaining_operational_iterations: 0
    })
    expect(callModel.mock.calls[3]?.[2]).not.toHaveProperty('requiresToolAction')
    expect(result.intent).toBe('answer')
    expect(result.trackedSteps).toEqual([{ label: 'Verify the files', status: 'completed' }])
  })

  it('keeps direct answers without tools on the fast path', async () => {
    const callModel = vi.fn().mockResolvedValue({ textContent: 'Pong.' })
    const result = await runAgentLoopWithCompletionReview({
      transcript: [{ role: 'user', content: 'Ping.' }], catalog: createCatalog(),
      callModel, executeFunction: vi.fn(), loadAgentSkill: async () => null
    })
    expect(result.answer).toBe('Pong.')
    expect(callModel).toHaveBeenCalledOnce()
  })

  it('uses a 256-iteration total budget by default', () => {
    expect(AGENT_MAX_ITERATIONS).toBe(256)
  })

  it.each([1, 3])('keeps the finishing pass inside a %i-turn owner limit', async (limit) => {
    let operationalTurns = 0
    const prepareContinuation = vi.fn(async (state) => state.transcript)
    const executeFunction = vi.fn(async () => ({ execution: {
      function: callable.qualifiedName, status: 'success', observation: 'Observed result.'
    } }))
    await runAgentLoop({
      transcript: [{ role: 'user', content: 'Inspect the sources.' }],
      catalog: createCatalog(), maxIterations: limit, finishingIterations: 16,
      prepareContinuation, executeFunction, loadAgentSkill: async () => null,
      callModel: async (_messages, _tools, options) => {
        if (options.isFinalizationAttempt) return { textContent: 'Results collected.' }
        operationalTurns += 1
        return { toolCalls: [toolCall(`lookup-${operationalTurns}`, CALLABLE_TOOL_NAME, {
          query: `source-${operationalTurns}`
        })] }
      }
    })
    expect(operationalTurns).toBe(limit)
    expect(executeFunction).toHaveBeenCalledTimes(limit)
    expect(prepareContinuation).toHaveBeenCalledTimes(limit > 1 ? 1 : 0)
  })

  it('keeps computer-use guidance out of the global prompt', () => {
    expect(AGENT_SYSTEM_PROMPT).not.toContain('<visual_inspection>')
    expect(AGENT_SYSTEM_PROMPT).not.toContain('Survey long pages')
  })

  it('blocks an ineffective computer-use retry before executing the tool', async () => {
    const catalog = createCatalog()
    const input = { pid: 42, window_id: 7, x: 500, y: 300 }
    const computerCallable: AgentCallableFunction = {
      ...callable,
      qualifiedName: 'computer_use.cua.click',
      toolkitId: 'computer_use',
      toolId: 'cua',
      functionName: 'click',
      functionConfig: {
        description: 'Click an observed control.',
        deduplicate_calls: false,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(Object.keys(input).map((key) => [key, { type: 'number' }]))
        }
      }
    }
    catalog.functionsByToolName.set(CALLABLE_TOOL_NAME, computerCallable)
    const executeFunction = vi.fn()
    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Fill the form without submitting.' }],
      catalog,
      initialExecutionHistory: Array.from({ length: 2 }, () => ({
        function: computerCallable.qualifiedName,
        status: 'success',
        requestedToolInput: JSON.stringify(input),
        observation: JSON.stringify({
          result: { effect: 'unverifiable' },
          post_action_state: { visual_state_id: 'unchanged' }
        })
      })),
      callModel: vi.fn()
        .mockResolvedValueOnce({ toolCalls: [toolCall('retry', CALLABLE_TOOL_NAME, input)] })
        .mockResolvedValueOnce({ textContent: 'The form remains incomplete.' }),
      executeFunction,
      loadAgentSkill: async () => null
    })
    expect(executeFunction).not.toHaveBeenCalled()
    expect(result.transcript).toContainEqual(expect.objectContaining({
      role: 'tool', toolCallId: 'retry', content: expect.stringContaining('retry blocked')
    }))
    expect(result.executionHistory).toHaveLength(2)
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
    expect(result.executionHistory[0]).toMatchObject({
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
      durationMs: expect.any(Number)
    })
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

  it('keeps a warned computer-use failure parseable under context pressure', async () => {
    const name = 'computer_use__cua__click'
    const cuaCallable: AgentCallableFunction = {
      ...callable, qualifiedName: 'computer_use.cua.click',
      toolkitId: 'computer_use', toolId: 'cua', functionName: 'click'
    }
    const catalog = createCatalog()
    catalog.functionsByToolName = new Map([[name, cuaCallable]])
    const observation = JSON.stringify({
      status: 'error', message: 'Background delivery unavailable.',
      data: { output: { error_code: 'background_unavailable' } },
      output_log_path: '/tmp/cua-refusal.log'
    })
    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Operate the app.' }],
      catalog,
      callModel: vi.fn()
        .mockResolvedValueOnce({ toolCalls: [toolCall('failed-click', name, { query: 'target' })] })
        .mockResolvedValueOnce({ textContent: 'The target refused background input.' }),
      executeFunction: async () => ({ execution: {
        function: cuaCallable.qualifiedName, status: 'error', observation,
        requestedToolInput: JSON.stringify({ query: 'target' })
      } }),
      loadAgentSkill: async () => null
    })
    const toolResult = result.transcript.find((message) => message.role === 'tool')!
    expect(JSON.parse(toolResult.content)).toMatchObject({
      status: 'error', data: { output: { error_code: 'background_unavailable' } },
      computer_use_convergence: expect.stringContaining('background delivery is unavailable')
    })
    const context = prepareAgentModelContext({
      transcript: result.transcript, systemPrompt: '', tools: [],
      compactionTriggerTokens: 1, forceCompaction: true
    })
    const history = JSON.stringify(context.transcript)
    expect(history).toContain('error')
    expect(history).toContain('/tmp/cua-refusal.log')
  })

  it('keeps operational model options unchanged near the iteration limit', async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [
          toolCall('collect-evidence', CALLABLE_TOOL_NAME, { query: 'Leon' })
        ]
      })
      .mockResolvedValueOnce({ textContent: 'Supported answer.' })

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
      isRecoveryAttempt: false
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
      isRecoveryAttempt: true,
      isOutputRecoveryAttempt: true
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
        if (modelTurn === 3) return { toolCalls: [toolCall('plan-2', AGENT_PLAN_TOOL_NAME, {
          steps: [{ label: 'Inspect source', status: 'completed' }]
        })] }
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
        toolkitProgressiveGuidance: 'Use toolkit-level evidence guidance.',
        toolId: 'ytdlp',
        toolName: 'yt-dlp',
        toolDescription: 'Download video metadata and subtitles.',
        toolProgressiveGuidance: 'Prefer exact subtitle timestamps.'
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
    const loader = catalog.tools.find(
      (tool) => tool.function.name === AGENT_TOOLKIT_LOADER_NAME
    )
    expect(loader?.function.description).not.toContain(
      'toolkit-level evidence guidance'
    )
    expect(loader?.function.description).not.toContain(
      'exact subtitle timestamps'
    )
    expect(buildAgentProgressiveGuidanceSystemPrompt(catalog)).toBe('')
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
    expect(buildAgentProgressiveGuidanceSystemPrompt(catalog)).toContain(
      'Use toolkit-level evidence guidance.'
    )
    expect(buildAgentProgressiveGuidanceSystemPrompt(catalog)).toContain(
      'Prefer exact subtitle timestamps.'
    )
  })

  it('preloads a toolkit when its registry label is an unambiguous match', () => {
    coreMocks.getFlattenedTools.mockReturnValue([
      {
        toolkitId: 'weather',
        toolkitName: 'Weather',
        toolkitDescription: 'Tools for weather lookup and forecasts.',
        toolId: 'openmeteo',
        toolName: 'Open-Meteo',
        toolDescription: 'Fetch current weather conditions.'
      },
      {
        toolkitId: 'search_web',
        toolkitName: 'Search & Web',
        toolkitDescription: 'Tools to search the web.',
        toolId: 'hosted',
        toolName: 'Hosted Search',
        toolDescription: 'Search current online sources.'
      }
    ])

    expect(
      findHighConfidenceAgentToolkitId(
        'What is the weather like in Shenzhen?'
      )
    ).toBe('weather')
  })

  it('keeps model-led discovery when registry metadata is ambiguous', () => {
    coreMocks.getFlattenedTools.mockReturnValue([
      {
        toolkitId: 'file_system',
        toolkitName: 'File System',
        toolkitDescription: 'Inspect files on the local system.',
        toolId: 'reader',
        toolName: 'Reader',
        toolDescription: 'Read a file.'
      },
      {
        toolkitId: 'operating_system_control',
        toolkitName: 'Operating System Control',
        toolkitDescription: 'Control the local operating system.',
        toolId: 'file',
        toolName: 'File',
        toolDescription: 'Read or write local files.'
      }
    ])

    expect(findHighConfidenceAgentToolkitId('Open a local file.')).toBeNull()
    expect(findHighConfidenceAgentToolkitId('Tell me a joke.')).toBeNull()
  })

  it('keeps model-led discovery for translated descriptive wording', () => {
    coreMocks.getFlattenedTools.mockReturnValue([
      {
        toolkitId: 'weather',
        toolkitName: 'Weather',
        toolkitDescription: 'Tools for weather lookup and forecasts.',
        toolId: 'openmeteo',
        toolName: 'Open-Meteo',
        toolDescription: 'Fetch current weather conditions.'
      }
    ])

    expect(findHighConfidenceAgentToolkitId('深圳今天天气如何？')).toBeNull()
  })

  it('omits a preloaded toolkit from the discovery catalog', () => {
    coreMocks.getFlattenedTools.mockReturnValue([
      {
        toolkitId: 'weather',
        toolkitName: 'Weather',
        toolkitDescription: 'Tools for weather lookup and forecasts.',
        toolId: 'openmeteo',
        toolName: 'Open-Meteo',
        toolDescription: 'Fetch current weather conditions.'
      },
      {
        toolkitId: 'search_web',
        toolkitName: 'Search & Web',
        toolkitDescription: 'Tools to search the web.',
        toolId: 'hosted',
        toolName: 'Hosted Search',
        toolDescription: 'Search current online sources.'
      }
    ])
    coreMocks.getToolFunctions.mockReturnValue({
      run: {
        description: 'Run the selected tool.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      }
    })

    const catalog = buildAgentToolCatalog(null, ['weather'])
    const loader = catalog.tools.find(
      (tool) => tool.function.name === AGENT_TOOLKIT_LOADER_NAME
    )

    expect(catalog.loadedToolkitIds).toEqual(new Set(['weather']))
    expect(catalog.tools.map((tool) => tool.function.name)).toContain(
      'weather__openmeteo__run'
    )
    expect(loader?.function.parameters).toMatchObject({
      properties: {
        toolkit_id: {
          enum: ['search_web']
        }
      }
    })
    expect(loader?.function.description).not.toContain('weather: Weather')
  })

  it('preloads only when the toolkit payload fits the routing budget', () => {
    coreMocks.getFlattenedTools.mockReturnValue([
      {
        toolkitId: 'weather',
        toolkitName: 'Weather',
        toolkitDescription: 'Tools for weather lookup and forecasts.',
        toolId: 'openmeteo',
        toolName: 'Open-Meteo',
        toolDescription: 'Fetch current weather conditions.'
      },
      {
        toolkitId: 'search_web',
        toolkitName: 'Search & Web',
        toolkitDescription: 'Tools to search current online sources.',
        toolId: 'hosted',
        toolName: 'Hosted Search',
        toolDescription: 'Search current online sources.'
      }
    ])
    coreMocks.getToolFunctions.mockReturnValue({
      run: {
        description: 'Run the selected tool.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      }
    })

    const normalCatalog = buildAgentToolCatalog()
    const preloadedCatalog = buildAgentToolCatalog(null, ['weather'])
    const cost = evaluateAgentToolkitPreloadCost(
      normalCatalog,
      preloadedCatalog,
      'Toolkit Context: none',
      (value) => Math.ceil(value.length / 4)
    )

    expect(cost.shouldPreload).toBe(true)
    expect(cost.additionalPayloadTokens).toBeLessThanOrEqual(
      cost.normalRoutingPayloadTokens
    )
  })

  it('keeps discovery when a matched toolkit exceeds the routing budget', () => {
    coreMocks.getFlattenedTools.mockReturnValue([
      {
        toolkitId: 'operating_system_control',
        toolkitName: 'Operating System Control',
        toolkitDescription: 'Control the local operating system.',
        toolId: 'shell',
        toolName: 'Shell',
        toolDescription: 'Execute local shell commands.'
      },
      {
        toolkitId: 'weather',
        toolkitName: 'Weather',
        toolkitDescription: 'Tools for weather lookup and forecasts.',
        toolId: 'openmeteo',
        toolName: 'Open-Meteo',
        toolDescription: 'Fetch current weather conditions.'
      }
    ])
    coreMocks.getToolFunctions.mockImplementation((toolkitId: string) => ({
      run: {
        description:
          toolkitId === 'operating_system_control'
            ? 'Execute with extensive options. '.repeat(1_000)
            : 'Run the selected tool.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      }
    }))

    const normalCatalog = buildAgentToolCatalog()
    const preloadedCatalog = buildAgentToolCatalog(null, [
      'operating_system_control'
    ])
    const cost = evaluateAgentToolkitPreloadCost(
      normalCatalog,
      preloadedCatalog,
      'Toolkit Context: none',
      (value) => Math.ceil(value.length / 4)
    )

    expect(cost.shouldPreload).toBe(false)
    expect(cost.additionalPayloadTokens).toBeGreaterThan(
      cost.normalRoutingPayloadTokens
    )
  })

  it('executes a preloaded toolkit in two model turns', async () => {
    coreMocks.getFlattenedTools.mockReturnValue([
      {
        toolkitId: 'weather',
        toolkitName: 'Weather',
        toolkitDescription: 'Tools for weather lookup and forecasts.',
        toolId: 'openmeteo',
        toolName: 'Open-Meteo',
        toolDescription: 'Fetch current weather conditions.'
      }
    ])
    coreMocks.getToolFunctions.mockReturnValue({
      getCurrentConditions: {
        description: 'Get current weather conditions for a location.',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' }
          },
          required: ['location'],
          additionalProperties: false
        }
      }
    })

    const catalog = buildAgentToolCatalog(null, ['weather'])
    let modelTurn = 0
    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Weather in Shenzhen?' }],
      catalog,
      callModel: async (_messages, tools) => {
        modelTurn += 1
        if (modelTurn === 1) {
          expect(tools.map((tool) => tool.function.name)).toContain(
            'weather__openmeteo__getCurrentConditions'
          )
          expect(tools.map((tool) => tool.function.name)).not.toContain(
            AGENT_TOOLKIT_LOADER_NAME
          )
          return {
            toolCalls: [
              toolCall(
                'weather-call',
                'weather__openmeteo__getCurrentConditions',
                {
                  location: 'Shenzhen',
                  [AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME]: 'Check Shenzhen weather'
                }
              )
            ]
          }
        }

        return { textContent: 'It is 29 C in Shenzhen.' }
      },
      executeFunction: async (selectedCallable) => ({
        execution: {
          function: selectedCallable.qualifiedName,
          status: 'success',
          observation: '29 C'
        }
      }),
      loadAgentSkill: async () => null
    })

    expect(modelTurn).toBe(2)
    expect(result.answer).toBe('It is 29 C in Shenzhen.')
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

  it('loads guidance only for the explicitly forced tool', () => {
    coreMocks.getFlattenedTools.mockReturnValue([
      {
        toolkitId: 'computer_use',
        toolkitName: 'Computer Use',
        toolkitDescription: 'Operate graphical interfaces.',
        toolkitProgressiveGuidance: 'Shared computer-use guidance.',
        toolId: 'cua',
        toolName: 'Cua',
        toolDescription: 'Operate local applications.',
        toolProgressiveGuidance: 'Cua driver guidance.'
      },
      {
        toolkitId: 'computer_use',
        toolkitName: 'Computer Use',
        toolkitDescription: 'Operate graphical interfaces.',
        toolkitProgressiveGuidance: 'Shared computer-use guidance.',
        toolId: 'remote',
        toolName: 'Remote Desktop',
        toolDescription: 'Operate a remote desktop.',
        toolProgressiveGuidance: 'Remote driver guidance.'
      }
    ])
    coreMocks.resolveToolById.mockReturnValue({
      toolkitId: 'computer_use',
      toolId: 'cua'
    })
    coreMocks.getToolFunctions.mockReturnValue({
      click: {
        description: 'Click one target.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false
        }
      }
    })

    const catalog = buildAgentToolCatalog('cua')
    const guidance = buildAgentProgressiveGuidanceSystemPrompt(catalog)

    expect(guidance).toContain('Shared computer-use guidance.')
    expect(guidance).toContain('Cua driver guidance.')
    expect(guidance).not.toContain('Remote driver guidance.')
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
      role: 'tool', content: largeObservation
    })
    expect(context.transcript.at(-1)?.content).toContain('/tmp/tool-output.log')
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
      loadedToolkitIds: ['communication'],
      transcript: [
        { role: 'assistant', content: 'Recipient lookup complete.' }
      ],
      activeSkillId: null
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
})


describe('collection plan state', () => {
  const collection = {
    scope: 'Requested documents from the authoritative list', enumeration: 'completed' as const,
    evidence: 'All pages inspected. Range A has two documents; range B is empty.', cursor: '',
    items: [
      { id: 'A', status: 'completed' as const, details: 'Verified /tmp/A.pdf against document A' },
      { id: 'B', status: 'pending' as const }
    ]
  }
  const plan = [{ label: 'Retrieve documents', status: 'in_progress' as const, collection }]

  it('merges item deltas and preserves coverage and verified outcomes across plan replacement', () => {
    const updated = parseAgentPlan(JSON.stringify({ steps: [{ ...plan[0],
      status: 'completed', collection: { ...collection, items: [
        { id: 'B', status: 'completed', details: 'Verified /tmp/B.pdf against document B' }
      ] }
    }] }), plan)
    expect(updated?.[0]?.collection?.items.map((item) => item.id)).toEqual(['A', 'B'])
    expect(updated?.[0]?.collection?.items[0]).toEqual(collection.items[0])
    expect(isAgentPlanComplete(updated!)).toBe(true)
    expect(parseAgentPlan(JSON.stringify({ steps: [{ label: 'Retrieve documents', status: 'completed' }] }), updated!)).toEqual(updated)
    expect(plan[0]?.collection.items[1]?.status).toBe('pending')
    expect(parseAgentPlan(JSON.stringify({ steps: [{ ...plan[0], collection: {
      ...collection, items: [{ id: 'A', status: 'pending' }]
    } }] }), plan)).toBeNull()
    expect(parseAgentPlan(JSON.stringify({ steps: [{ ...plan[0], collection: {
      ...collection, items: [{ id: 'A', status: 'pending', details: 'Source version changed; the saved copy is outdated.' }]
    } }] }), plan)?.[0]?.collection?.items[0]?.status).toBe('pending')
  })

  it('rejects lost ledgers, premature completion and execution before enumeration', () => {
    for (const steps of [
      [{ label: 'Renamed step', status: 'completed' }],
      [{ ...plan[0], status: 'completed' }],
      [{ ...plan[0], collection: { ...collection, enumeration: 'in_progress', items: [
        { id: 'B', status: 'in_progress' }
      ] } }],
      [{ ...plan[0], collection: { ...collection, items: [
        { id: 'B', status: 'completed' }
      ] } }],
      [{ ...plan[0], collection: { ...collection, items: [collection.items[0], collection.items[0]] } }]
    ]) expect(parseAgentPlan(JSON.stringify({ steps }), plan)).toBeNull()
  })

  it('keeps an unfinished collection blocked at the limit even if the reviewer says complete', async () => {
    const result = await runAgentLoopWithCompletionReview({
      transcript: [{ role: 'user', content: 'Retrieve the requested documents.' }], catalog: createCatalog(),
      initialTrackedSteps: plan, maxIterations: 0,
      callModel: vi.fn()
        .mockResolvedValueOnce({ textContent: 'All done.' })
        .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'complete', reason: 'Done.' }) }),
      executeFunction: vi.fn(), loadAgentSkill: async () => null
    })
    expect(result.intent).toBe('blocked')
    expect(result.trackedSteps).toEqual(plan)
  })
})
