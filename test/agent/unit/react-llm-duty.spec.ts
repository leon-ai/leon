import { ToolConcurrency } from '@/types'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { saveConnection } from '@/core/connections/connection-service'
import { ConnectionStatus } from '@/core/connections/connection-store'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LogHelper } from '@/helpers/log-helper'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { runWithConversationSession } from '@/core/session-manager/session-context'
import { ConversationSessionManager } from '@/core/session-manager'
import { ReActLLMDuty } from '@/core/llm-manager/llm-duties/react-llm-duty'
import { runCompletionAttempt } from '@/core/llm-manager/llm-provider/llm-provider-attempt'
import type { PreparedCompletionParams } from '@/core/llm-manager/llm-provider/llm-provider-types'
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
  AgentModelResponseTimeoutError,
  buildAgentProgressiveGuidanceSystemPrompt,
  buildAgentToolCatalog,
  evaluateAgentToolkitPreloadCost,
  findHighConfidenceAgentToolkitId,
  runAgentLoop as runAgentLoopWithCompletionReview
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-loop'
import {
  AGENT_PLAN_GUIDANCE,
  createAgentPlanTool,
  parseAgentPlan,
  isAgentPlanComplete
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-plan'
import { findDuplicateToolInputMatch } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-helpers'
import { runToolExecution } from '@/core/llm-manager/llm-duties/react-llm-duty/tool-execution'
import { emitPlanWidget } from '@/core/llm-manager/llm-duties/react-llm-duty/plan-widget'
import {
  createAgentLoopContinuationState,
  isAgentLoopContinuationStateValid
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-loop-continuation'
import {
  buildBoundedToolObservation,
  prepareAgentModelContext
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-context-budget'
import {
  AGENT_MAX_PARALLEL_TOOL_CALLS,
  AGENT_TOOL_CALL_WAIT_NOTICE_DELAY_MS,
  AGENT_TOOL_CALL_DIAGNOSIS_DELAY_MS,
  AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME,
  AGENT_MODEL_RESPONSE_TIMEOUT_MS,
  AGENT_MODEL_RESPONSE_MAX_DURATION_MS
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-constants'
import {
  LLMDuties,
  LLMProviders,
  CompletionFailureKind,
  type AgentToolTranscriptMessage,
  type ProviderReasoningItem,
  type OpenAIToolCall,
  type CompletionParams
} from '@/core/llm-manager/types'
import { ModelResponseState, type ModelResponseStatus } from '@/core/leon-interface/types'

const coreMocks = vi.hoisted(() => ({
  getFlattenedTools: vi.fn(),
  getToolFunctions: vi.fn(),
  needsToolConnection: vi.fn().mockReturnValue(true),
  resolveToolById: vi.fn(),
  executeTool: vi.fn(),
  emitAnswerToChatClients: vi.fn(),
  emitToChatClients: vi.fn(),
  prompt: vi.fn(),
  consumeLastProviderErrorMessage: vi.fn(),
  prepareAgentTranscript: vi.fn(async (transcript: AgentToolTranscriptMessage[]) => transcript)
}))

vi.mock('@/core/connections/connection-service', () => ({
  saveConnection: vi.fn(),
  saveOAuthApplicationSettings: vi.fn()
}))

vi.mock('@/core', () => ({
  PERSONA: {
    getCompactDutySystemPrompt: (prompt: string): string => prompt
  },
  LLM_PROVIDER: {
    prompt: coreMocks.prompt,
    consumeLastProviderErrorMessage: coreMocks.consumeLastProviderErrorMessage,
    prepareAgentTranscript: coreMocks.prepareAgentTranscript
  },
  BRAIN: {
    wernicke: (
      key: string,
      _fallback: string,
      values: Record<string, string> = {}
    ): string => values['{{ message }}'] || key
  },
  SOCKET_SERVER: {
    emitAnswerToChatClients: coreMocks.emitAnswerToChatClients,
    emitToChatClients: coreMocks.emitToChatClients
  },
  TOOL_EXECUTOR: {
    executeTool: coreMocks.executeTool
  },
  TOOLKIT_REGISTRY: {
    getConnectionTools: (): never[] => [],
    getConnectionTool: (): Record<string, unknown> => ({
      toolkit_id: 'example', tool_id: 'account',
      connection: { methods: { api_key: { settings: { access_token: null } } } }
    }),
    needsToolConnection: coreMocks.needsToolConnection,
    getFlattenedTools: coreMocks.getFlattenedTools,
    getToolFunctions: coreMocks.getToolFunctions,
    getToolConcurrency: (): ToolConcurrency => ToolConcurrency.Parallel,
    resolveToolById: coreMocks.resolveToolById
  }
}))

const CALLABLE_TOOL_NAME = 'test__lookup__run'

it('emits plan replacements with their current display time and a stable message ID', () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
  emitPlanWidget([], null, 'plan-first', false)

  expect(coreMocks.emitAnswerToChatClients).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'plan-first', widget: 'PlanWidget', sentAt: 1_000 })
  )

  now.mockReturnValue(3_000)
  emitPlanWidget([], null, 'plan-first', true)

  expect(coreMocks.emitAnswerToChatClients).toHaveBeenLastCalledWith(
    expect.objectContaining({
      id: 'plan-first', widget: 'PlanWidget', replaceMessageId: 'plan-first', sentAt: 3_000
    })
  )
})

it.each(['success', 'error', 'background', 'throw'])(
  'reports title and dispatch duration for a %s call to live cards and durable progress',
  async (outcome) => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const onProgress = vi.fn()
    const toolCallTitle = 'Look up the requested value'
    const displayNames = { toolkitName: 'Test Toolkit', toolName: 'Official Lookup' }

    coreMocks.resolveToolById.mockReturnValue(displayNames)

    const output = outcome === 'background'
      ? { execution: { id: 'job-1', state: 'running' } }
      : { value: 42 }

    coreMocks.executeTool.mockImplementationOnce(async (input) => {
      input.onProgress({ message: 'Working.' })
      input.onProgress({ key: 'bridges.tools.command_started', message: 'Executing command.' })
      input.onProgress({
        key: 'bridges.tools.command_output_delta', message: 'First line\n',
        data: { output: 'First line\n' }
      })
      input.onProgress({
        key: 'bridges.tools.command_output_delta', message: 'Second line\n',
        data: { output: 'Second line\n' }
      })
      now.mockReturnValue(2_234)

      if (outcome === 'throw') {
        throw new Error('Worker disconnected.')
      }

      return {
        status: outcome === 'error' ? 'error' : 'success',
        message: 'Result returned.',
        data: { output }
      }
    })

    const execution = runToolExecution(
      'test', 'lookup', 'run', '{}', {}, undefined, toolCallTitle, onProgress
    )

    if (outcome === 'throw') {
      await expect(execution).rejects.toThrow('Worker disconnected.')
    } else {
      await execution
    }

    const status = outcome === 'error' || outcome === 'throw' ? 'error' : 'success'
    expect(coreMocks.emitAnswerToChatClients).toHaveBeenCalledWith(expect.objectContaining({
      toolPhase: 'progress', message: 'Executing command.'
    }))
    expect(coreMocks.emitAnswerToChatClients).toHaveBeenCalledWith(expect.objectContaining({
      toolPhase: 'output_delta', outputDelta: 'Second line\n'
    }))
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running', commandOutput: 'First line\nSecond line\n',
      lastOutputAt: expect.any(Number)
    }))
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      status,
      toolCallTitle,
      ...displayNames,
      durationMs: 1_234
    }))
    expect(coreMocks.emitAnswerToChatClients).toHaveBeenLastCalledWith(
      expect.objectContaining({ toolPhase: 'output', status, toolCallTitle, ...displayNames, durationMs: 1_234 })
    )
    expect(onProgress.mock.calls.every(([event]) => event.toolCallTitle === toolCallTitle))
      .toBe(true)
    expect(onProgress.mock.calls.every(([event]) =>
      event.toolkitName === displayNames.toolkitName &&
      event.toolName === displayNames.toolName
    )).toBe(true)

    if (outcome === 'background') {
      const callCount = onProgress.mock.calls.length
      const input = coreMocks.executeTool.mock.lastCall?.[0]
      input.onProgress({ message: 'Still working.' })
      expect(onProgress).toHaveBeenCalledTimes(callCount)
    }

    coreMocks.resolveToolById.mockReturnValue(null)
  }
)

it('announces binary readiness only after actual preparation starts', async () => {
  const onPreparationProgress = vi.fn(async (): Promise<void> => {})
  const readyReport = {
    key: 'bridges.tools.binary_ready',
    message: 'Binary ready.',
    data: { binary_name: 'fixture' }
  }
  const run = async (): Promise<void> => {
    await runToolExecution(
      'test',
      'lookup',
      'run',
      '{}',
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      onPreparationProgress
    )
  }

  coreMocks.executeTool.mockImplementationOnce(async (input) => {
    input.onProgress(readyReport)

    return { status: 'success', data: { output: {} } }
  })

  await run()

  expect(onPreparationProgress).not.toHaveBeenCalled()
  expect(coreMocks.emitAnswerToChatClients).not.toHaveBeenCalledWith(
    expect.objectContaining({ toolPhase: 'preparation' })
  )

  coreMocks.executeTool.mockImplementationOnce(async (input) => {
    input.onProgress({
      key: 'bridges.tools.binary_not_found',
      message: 'Downloading missing binary.',
      data: { binary_name: 'fixture' }
    })
    input.onProgress(readyReport)
    input.onProgress(readyReport)

    return { status: 'success', data: { output: {} } }
  })

  await run()

  expect(onPreparationProgress.mock.calls).toEqual([
    ['Downloading missing binary.'],
    ['Binary ready.'],
    ['react.tool.ready']
  ])
  expect(coreMocks.emitAnswerToChatClients).toHaveBeenCalledWith(
    expect.objectContaining({
      toolPhase: 'preparation',
      message: 'Downloading missing binary.'
    })
  )
})

it('submits connection secrets without retaining them in the loop transcript', async () => {
  const secret = 'fixture-connection-secret'
  const call: OpenAIToolCall = {
    id: 'connect', type: 'function',
    function: {
      name: 'setup_connection',
      arguments: JSON.stringify({
        provider: 'example.account', method: 'api_key',
        credentials: { access_token: secret }
      })
    }
  }
  const transcript: AgentToolTranscriptMessage[] = []
  const blocked = {
    function: callable.qualifiedName, status: 'error',
    observation: JSON.stringify({
      connection_required: true, required_connections: ['example.account']
    })
  }
  coreMocks.needsToolConnection.mockReturnValue(true)
  const callModel = vi.fn()
    .mockImplementationOnce(async (_messages, tools) => {
      expect(tools.some((tool: { function: { name: string } }) => tool.function.name === 'setup_connection')).toBe(false)
      return { toolCalls: [toolCall('lookup', CALLABLE_TOOL_NAME, { query: 'account' })] }
    })
    .mockImplementationOnce(async (_messages, tools) => {
      const setup = tools.find((tool: { function: { name: string } }) => tool.function.name === 'setup_connection')
      expect(setup.function.parameters.properties.provider.enum).toEqual(['example.account'])
      return { toolCalls: [call], textContent: '' }
    })
    .mockImplementationOnce(async (_messages, tools) => {
      expect(tools.some((tool: { function: { name: string } }) => tool.function.name === 'setup_connection')).toBe(false)
      return { textContent: 'Connected.' }
    })
  vi.mocked(saveConnection).mockImplementationOnce(async () => {
    coreMocks.needsToolConnection.mockReturnValue(false)
    return {
      status: ConnectionStatus.Connected, provider: 'example.account',
      auth_type: 'api_key', connected_at: '2026-09-30T00:00:00Z'
    }
  })

  const result = await runAgentLoop({
    transcript, catalog: createCatalog(), callModel,
    executeFunction: vi.fn().mockResolvedValue({ execution: blocked }),
    loadAgentSkill: async () => null, maxIterations: 3
  })

  expect(saveConnection).toHaveBeenCalledWith({
    provider: 'example.account', auth_type: 'api_key',
    credentials: { access_token: secret }
  })
  expect(JSON.stringify(result)).not.toContain(secret)
  expect(JSON.stringify(transcript)).toContain('***')

  vi.mocked(saveConnection).mockRejectedValueOnce(new Error(secret))
  coreMocks.needsToolConnection.mockReturnValue(true)
  callModel.mockImplementationOnce(async (_messages, tools) => {
    expect(tools.some((tool: { function: { name: string } }) => tool.function.name === 'setup_connection')).toBe(true)
    return { toolCalls: [call], textContent: '' }
  })
    .mockResolvedValueOnce({ textContent: 'Setup failed.' })
  const failure = await runAgentLoop({
    transcript: [], catalog: createCatalog(), callModel,
    initialExecutionHistory: [blocked],
    executeFunction: vi.fn(), loadAgentSkill: async () => null, maxIterations: 2
  })
  expect(JSON.stringify(failure)).not.toContain(secret)
  expect(JSON.stringify(failure)).toContain('Connection setup failed')
})

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
    loadedToolNames: new Set(['test.lookup']),
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
  it.each(['tool', 'answer'])(
    'reconsiders a proposed %s when owner messages arrive during model generation',
    async (responseKind) => {
      const manager = new ConversationSessionManager()
      const turn = manager.openAgentTurn('steering')
      const receipts: Array<Promise<boolean>> = []
      const files = [{ mediaType: 'image/png', dataBase64: 'aW1hZ2U=' }]
      const prepare = vi.fn(async () => ({
        role: 'user' as const,
        content: 'Use this reference.',
        files
      }))
      const executeFunction = vi.fn()
      const applied = vi.fn()
      const transcript: AgentToolTranscriptMessage[] = []
      const callModel = vi.fn()
        .mockImplementationOnce(async () => {
          receipts.push(manager.queueAgentMessage('steering', prepare)!)
          receipts.push(manager.queueAgentMessage('steering', async () => ({
            role: 'user', content: 'Keep the answer brief.'
          }))!)

          return responseKind === 'tool'
            ? { toolCalls: [toolCall('stale', CALLABLE_TOOL_NAME, { query: 'old' })] }
            : { textContent: 'An answer without the new instructions.' }
        })
        .mockImplementationOnce(async (messages) => {
          expect(messages).toEqual([
            { role: 'user', content: 'Use this reference.', files },
            { role: 'user', content: 'Keep the answer brief.' }
          ])

          return { textContent: 'Updated answer.' }
        })

      try {
        const result = await runAgentLoop({
          transcript, catalog: createCatalog(), callModel, executeFunction,
          drainOwnerMessages: turn.drainOwnerMessages,
          onOwnerMessagesApplied: applied,
          loadAgentSkill: async () => null
        })

        expect(result.answer).toBe('Updated answer.')
        expect(executeFunction).not.toHaveBeenCalled()
        expect(callModel).toHaveBeenCalledTimes(2)
        expect(prepare).toHaveBeenCalledTimes(1)
        expect(applied).toHaveBeenCalledTimes(1)
        expect(await Promise.all(receipts)).toEqual([true, true])
      } finally {
        turn.close()
      }
    }
  )

  it('settles a running parallel batch before skipping unstarted calls and applying owner instructions', async () => {
    const catalog = createCatalog()
    const serialName = 'test__lookup__serial'
    catalog.functionsByToolName.set(serialName, {
      ...callable,
      concurrency: ToolConcurrency.Serial
    })
    const pending: AgentToolTranscriptMessage[] = []
    const finished: string[] = []
    const transcript: AgentToolTranscriptMessage[] = []
    const executeFunction = vi.fn(async (_fn, input) => {
      const { query } = JSON.parse(input)

      if (query === 'one') {
        pending.push({ role: 'user', content: 'Stop the remaining lookups.' })
      }

      await Promise.resolve()
      finished.push(query)

      return { execution: {
        function: callable.qualifiedName, status: 'success', observation: input
      } }
    })
    const callModel = vi.fn()
      .mockResolvedValueOnce({ toolCalls: [
        toolCall('one', CALLABLE_TOOL_NAME, { query: 'one' }),
        toolCall('two', CALLABLE_TOOL_NAME, { query: 'two' }),
        toolCall('barrier', serialName, { query: 'barrier' }),
        toolCall('three', CALLABLE_TOOL_NAME, { query: 'three' })
      ] })
      .mockImplementationOnce(async (messages) => {
        expect(finished).toEqual(['one', 'two'])
        expect(messages.filter((message: AgentToolTranscriptMessage) => message.role === 'tool'))
          .toEqual([
            expect.objectContaining({ toolCallId: 'one' }),
            expect.objectContaining({ toolCallId: 'two' }),
            expect.objectContaining({ toolCallId: 'barrier', content: expect.stringContaining('skipped') }),
            expect.objectContaining({ toolCallId: 'three', content: expect.stringContaining('skipped') })
          ])
        expect(messages.at(-1)).toEqual({ role: 'user', content: 'Stop the remaining lookups.' })

        return { textContent: 'Stopped.' }
      })

    const result = await runAgentLoop({
      transcript, catalog, callModel, executeFunction,
      drainOwnerMessages: async () => pending.splice(0),
      loadAgentSkill: async () => null
    })

    expect(result.answer).toBe('Stopped.')
    expect(executeFunction).toHaveBeenCalledTimes(2)
    expect(result.executionHistory).toHaveLength(2)
    expect(callModel).toHaveBeenCalledTimes(2)
  })

  it('reconsiders an ending when owner input arrives during completion review', async () => {
    const pending: AgentToolTranscriptMessage[] = []
    let reviewed = false
    const callModel = vi.fn()
      .mockResolvedValueOnce({ toolCalls: [toolCall('lookup', CALLABLE_TOOL_NAME, { query: 'one' })] })
      .mockResolvedValueOnce({ textContent: 'Original answer.' })
      .mockImplementationOnce(async (_messages, _tools, options) => {
        expect(options.isCompletionReview).toBe(true)
        pending.push({ role: 'user', content: 'Also explain the result.' })
        reviewed = true

        return { textContent: JSON.stringify({ status: 'complete', reason: 'Verified.' }) }
      })
      .mockImplementationOnce(async (messages, _tools, options) => {
        expect(reviewed).toBe(true)
        expect(options.isCompletionReview).toBeUndefined()
        expect(messages.at(-1)).toEqual({ role: 'user', content: 'Also explain the result.' })

        return { textContent: 'Answer with explanation.' }
      })
      .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'complete', reason: 'Verified.' }) })

    const result = await runAgentLoopWithCompletionReview({
      transcript: [], catalog: createCatalog(), callModel,
      executeFunction: async () => ({ execution: {
        function: callable.qualifiedName, status: 'success', observation: 'Verified result.'
      } }),
      drainOwnerMessages: async () => pending.splice(0),
      loadAgentSkill: async () => null
    })

    expect(result.answer).toBe('Answer with explanation.')
    expect(result.transcript.some((message) => message.content === 'Original answer.')).toBe(false)
  })

  it('retains owner updates and attachments when final synthesis retries with reduced evidence', async () => {
    const files = [{ mediaType: 'image/png', dataBase64: 'aW1hZ2U=' }]
    const update: AgentToolTranscriptMessage = {
      role: 'user', content: 'Explain this reference instead.', files
    }
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Original request.' },
      {
        role: 'assistant', content: '',
        toolCalls: [toolCall('old', CALLABLE_TOOL_NAME, { query: 'old' })]
      },
      { role: 'tool', toolCallId: 'old', toolName: CALLABLE_TOOL_NAME, content: 'Earlier result.' },
      update
    ]
    const callModel = vi.fn()
      .mockResolvedValueOnce({ isTruncated: true, textContent: 'Partial answer.' })
      .mockImplementationOnce(async (messages) => {
        expect(messages.at(-1)).toEqual(update)
        expect(messages.filter((message: AgentToolTranscriptMessage) => message.role === 'tool'))
          .toEqual([])

        return { textContent: 'Reference explained.' }
      })

    const result = await runAgentLoop({
      transcript, catalog: createCatalog(), callModel,
      executeFunction: vi.fn(), loadAgentSkill: async () => null,
      maxIterations: 0
    })

    expect(result.answer).toBe('Reference explained.')
  })

  it('rechecks owner input received during synthesis without renewing the tool budget', async () => {
    const pending: AgentToolTranscriptMessage[] = []
    const executeFunction = vi.fn()
    const callModel = vi.fn()
      .mockImplementationOnce(async () => {
        pending.push({ role: 'user', content: 'Use a shorter explanation.' })

        return { textContent: 'Stale explanation.' }
      })
      .mockImplementationOnce(async (messages, tools, options) => {
        expect(messages.at(-1)).toEqual({ role: 'user', content: 'Use a shorter explanation.' })
        expect(options.isFinalizationAttempt).toBe(true)
        expect(tools.map((tool: { function: { name: string } }) => tool.function.name))
          .toEqual([AGENT_CLARIFICATION_TOOL_NAME])

        return { textContent: 'Short explanation.' }
      })

    const result = await runAgentLoop({
      transcript: [], catalog: createCatalog(), callModel, executeFunction,
      drainOwnerMessages: async () => pending.splice(0),
      loadAgentSkill: async () => null, maxIterations: 0
    })

    expect(result.answer).toBe('Short explanation.')
    expect(executeFunction).not.toHaveBeenCalled()
  })

  it('exposes execution controls immediately after a retained handle is returned', async () => {
    coreMocks.getFlattenedTools.mockReturnValue([{
      toolkitId: 'system_utilities', toolkitName: 'System Utilities',
      toolkitDescription: 'Manage executions', toolId: 'tool_executions',
      toolName: 'Tool Executions', toolDescription: 'Read retained results'
    }])
    coreMocks.getToolFunctions.mockReturnValue({
      read: { description: 'Read saved results', parameters: {
        type: 'object', properties: { executionId: { type: 'string' } },
        required: ['executionId']
      } }
    })
    const executeFunction = vi.fn().mockResolvedValue({
      executionHandle: { id: 'retained', state: 'completed' },
      execution: { function: callable.qualifiedName, status: 'success', observation: 'Saved results' }
    })
    const callModel = vi.fn()
      .mockResolvedValueOnce({ toolCalls: [toolCall('scan', CALLABLE_TOOL_NAME, { query: 'files' })] })
      .mockImplementationOnce(async (_messages, tools) => {
        expect(tools.map((tool: { function: { name: string } }) => tool.function.name))
          .toContain('system_utilities__tool_executions__read')

        return { textContent: 'Done.' }
      })

    await runAgentLoop({
      transcript: [], catalog: createCatalog(), callModel, executeFunction,
      loadAgentSkill: async () => null
    })
    expect(executeFunction).toHaveBeenCalledTimes(1)
  })

  it('runs ordinary calls concurrently by default and preserves emitted history and result order', async () => {
    const catalog = createCatalog()
    catalog.functionsByToolName.set(CALLABLE_TOOL_NAME, {
      ...callable,
      functionConfig: callable.functionConfig
    })
    const started: string[] = []
    let releaseFirst: () => void = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const result = await runAgentLoop({
      transcript: [],
      catalog,
      callModel: vi.fn()
        .mockResolvedValueOnce({ toolCalls: [
          toolCall('first', CALLABLE_TOOL_NAME, { query: 'first' }),
          toolCall('second', CALLABLE_TOOL_NAME, { query: 'second' })
        ] })
        .mockResolvedValueOnce({ textContent: 'Done.' }),
      executeFunction: async (_callable, input) => {
        const { query } = JSON.parse(input)
        started.push(query)
        if (query === 'first') {
          await firstGate
        } else {
          releaseFirst()
          throw new Error('second lookup failed')
        }

        return { execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: query,
          requestedToolInput: input
        } }
      },
      loadAgentSkill: async () => null,
      maxIterations: 2
    })

    expect(started).toEqual(['first', 'second'])
    expect(result.executionHistory.map((record) => record.status)).toEqual(['success', 'error'])
    expect(result.transcript.filter((message) => message.role === 'tool')
      .map((message) => message.toolCallId)).toEqual(['first', 'second'])
  }, 5_000)

  it('keeps shared-session calls ordered and deduplicates identical parallel calls within a batch', async () => {
    for (const parallel of [false, true]) {
      const catalog = createCatalog()
      catalog.functionsByToolName.set(CALLABLE_TOOL_NAME, {
        ...callable,
        functionConfig: callable.functionConfig,
        concurrency: parallel ? ToolConcurrency.Parallel : ToolConcurrency.Serial
      })
      let active = 0
      let maximumActive = 0
      const executeFunction = vi.fn(async (_callable, input: string) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await Promise.resolve()
        await Promise.resolve()
        active -= 1

        return { execution: {
          function: callable.qualifiedName,
          status: 'success',
          observation: input,
          requestedToolInput: input
        } }
      })
      const result = await runAgentLoop({
        transcript: [], catalog,
        callModel: vi.fn()
          .mockResolvedValueOnce({ toolCalls: [
            toolCall('one', CALLABLE_TOOL_NAME, { query: 'same' }),
            toolCall('two', CALLABLE_TOOL_NAME, { query: parallel ? 'same' : 'other' })
          ] })
          .mockResolvedValueOnce({ textContent: 'Done.' }),
        executeFunction,
        loadAgentSkill: async () => null,
        maxIterations: 2
      })

      expect(maximumActive).toBe(1)
      expect(executeFunction).toHaveBeenCalledTimes(parallel ? 1 : 2)
      if (parallel) {
        expect(JSON.stringify(result.transcript)).toContain('Duplicate call blocked')
      }
    }
  })

  it('drains both safe calls when the owner cancels the agent run', async () => {
    const catalog = createCatalog()
    catalog.functionsByToolName.set(CALLABLE_TOOL_NAME, {
      ...callable,
      functionConfig: callable.functionConfig
    })
    const controller = new AbortController()
    let started = 0
    let finished = 0
    const run = runAgentLoop({
      transcript: [], catalog, signal: controller.signal,
      callModel: vi.fn().mockResolvedValueOnce({ toolCalls: [
        toolCall('one', CALLABLE_TOOL_NAME, { query: 'one' }),
        toolCall('two', CALLABLE_TOOL_NAME, { query: 'two' })
      ] }),
      executeFunction: async (_callable, input) => {
        const canceled = new Promise<void>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        started += 1
        if (started === 2) {
          controller.abort(new Error('Owner canceled.'))
        }
        await canceled
        finished += 1

        return { execution: {
          function: callable.qualifiedName, status: 'success', observation: input
        } }
      },
      loadAgentSkill: async () => null,
      maxIterations: 1
    })

    await expect(run).rejects.toThrow('Owner canceled.')
    expect(finished).toBe(2)
  }, 5_000)

  it('treats serial calls as barriers between concurrent groups', async () => {
    const catalog = createCatalog()
    const serialName = 'test__lookup__serial'
    catalog.functionsByToolName.set(CALLABLE_TOOL_NAME, {
      ...callable,
      functionConfig: callable.functionConfig
    })
    catalog.functionsByToolName.set(serialName, { ...callable, qualifiedName: 'test.lookup.serial', concurrency: ToolConcurrency.Serial })
    const finished: string[] = []
    await runAgentLoop({
      transcript: [], catalog,
      callModel: vi.fn()
        .mockResolvedValueOnce({ toolCalls: [
          toolCall('one', CALLABLE_TOOL_NAME, { query: 'one' }),
          toolCall('two', CALLABLE_TOOL_NAME, { query: 'two' }),
          toolCall('barrier', serialName, { query: 'barrier' }),
          toolCall('three', CALLABLE_TOOL_NAME, { query: 'three' })
        ] })
        .mockResolvedValueOnce({ textContent: 'Done.' }),
      executeFunction: async (fn, input) => {
        const { query } = JSON.parse(input)
        if (query === 'barrier') {
          expect(finished.sort()).toEqual(['one', 'two'])
        }
        if (query === 'three') {
          expect(finished).toContain('barrier')
        }
        await Promise.resolve()
        finished.push(query)

        return { execution: {
          function: fn.qualifiedName, status: 'success', observation: input,
          requestedToolInput: input
        } }
      },
      loadAgentSkill: async () => null,
      maxIterations: 2
    })
    expect(finished).toHaveLength(4)
  })

  it('keeps reasoning from successive model calls separate in live events and saved traces', async () => {
    const displayNames = { toolkitName: 'Test Toolkit', toolName: 'Official Lookup' }
    coreMocks.resolveToolById.mockReturnValue(displayNames)

    const modelState = CONFIG_STATE.getModelState()
    vi.spyOn(modelState, 'getAgentProvider').mockReturnValue(LLMProviders.OpenAI)
    vi.spyOn(modelState, 'getAgentTarget').mockReturnValue({
      provider: LLMProviders.OpenAI,
      model: 'gpt-6-sol'
    })
    vi.spyOn(CONFIG_STATE.getModelSettingsState(), 'getSettings').mockReturnValue({
      reasoning: 'on',
      speed: 'auto'
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const duty = new ReActLLMDuty({ input: 'Check the weather.' })
    Object.assign(duty, {
      // A turn ID must not group reasoning across separate model calls.
      reasoningGenerationId: 'turn',
      writeAgentPromptLog: vi.fn()
    })
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Check the weather.' }
    ]
    const catalog = createCatalog()
    const call = toolCall('lookup', CALLABLE_TOOL_NAME, { query: 'weather' })
    coreMocks.prompt
      .mockImplementationOnce(async (_messages, params) => {
        params.onAttempt({
          attemptId: 'weather-attempt', startedAt: 1_000, provider: LLMProviders.OpenAI,
          duty: 'react', transport: 'http', outcome: 'completed', elapsedMs: 500,
          inferenceTimeoutMs: 120_000, streamIdleTimeoutMs: 30_000,
          streamOpenMs: 50, firstToolInputMs: 300, lastEvent: 'finish'
        })
        params.onReasoningToken('Checking ')
        params.onReasoningToken('the weather.')
        params.onToolCall(call)

        return { output: '', toolCalls: [call] }
      })
      .mockImplementationOnce(async (_messages, params) => {
        params.onReasoningToken('Reading ')
        params.onReasoningToken('the result.')

        return { output: 'It is sunny.' }
      })

    await duty['callAgentModel'](
      transcript,
      'Check the weather.',
      catalog.tools,
      { isRecoveryAttempt: false },
      undefined,
      catalog.functionsByToolName
    )
    expect(duty['responseTraceCollector'].snapshot({}).toolCalls[0]).toMatchObject({
      ...displayNames,
      status: 'preparing',
      preparationStartedAt: 1_000
    })
    expect(duty['responseTraceCollector'].snapshot({}).inferences).toEqual([
      expect.objectContaining({
        attemptId: 'weather-attempt', phase: 'agent', elapsedMs: 500,
        streamOpenMs: 50, firstToolInputMs: 300
      })
    ])
    duty['closeStreamedToolCalls']()
    expect(duty['responseTraceCollector'].snapshot({}).toolCalls[0]).toMatchObject({
      ...displayNames,
      status: 'error'
    })

    now.mockReturnValue(2_000)
    duty['responseTraceCollector'].record({
      type: 'tool_call',
      toolCall: { id: call.id, name: callable.qualifiedName, status: 'success' }
    })
    transcript.push(
      { role: 'assistant', content: '', toolCalls: [call] },
      {
        role: 'tool',
        toolCallId: call.id,
        toolName: CALLABLE_TOOL_NAME,
        content: 'Sunny.'
      }
    )
    now.mockReturnValue(3_000)
    await duty['callAgentModel'](
      transcript,
      'Check the weather.',
      catalog.tools,
      { isRecoveryAttempt: false }
    )

    const events = coreMocks.emitToChatClients.mock.calls
      .filter(([event]) => event === 'llm-reasoning-token')
      .map(([, payload]) => payload)
    expect(events).toHaveLength(4)
    expect(events[0].generationId).toBe(events[1].generationId)
    expect(events[2].generationId).toBe(events[3].generationId)
    expect(events[2].generationId).not.toBe(events[0].generationId)
    const trace = duty['responseTraceCollector'].snapshot({})
    expect(trace.reasoning).toEqual([
      {
        id: events[0].generationId,
        text: 'Checking the weather.',
        phase: 'agent',
        startedAt: 1_000
      },
      {
        id: events[2].generationId,
        text: 'Reading the result.',
        phase: 'agent',
        startedAt: 3_000
      }
    ])
  })

  it.each(['model', 'tool'])('does not recover or verify after cancellation during %s execution', async (phase) => {
    const controller = new AbortController()
    const reason = new Error('Owner canceled')
    const callModel = vi.fn(async () => {
      if (phase === 'model') {
        controller.abort(reason)
        throw new AgentModelProviderError('Interrupted inference', true)
      }
      return { toolCalls: [toolCall('lookup', CALLABLE_TOOL_NAME, { query: 'weather' })] }
    })
    const executeFunction = vi.fn(async () => {
      controller.abort(reason)
      throw reason
    })
    await expect(runAgentLoopWithCompletionReview({
      signal: controller.signal, transcript: [{ role: 'user', content: 'Check the weather.' }],
      catalog: createCatalog(), callModel, executeFunction,
      loadAgentSkill: async () => null
    })).rejects.toBe(reason)
    expect(callModel).toHaveBeenCalledTimes(1)
    expect(executeFunction).toHaveBeenCalledTimes(phase === 'tool' ? 1 : 0)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    coreMocks.getFlattenedTools.mockReturnValue([])
    coreMocks.resolveToolById.mockReturnValue(null)
    coreMocks.getToolFunctions.mockReturnValue(null)
  })

  it('retains provider reasoning through tool exchanges and continuation', async () => {
    const reasoning = 'The lookup is needed to answer the question.'
    const reasoningItems: ProviderReasoningItem[] = [{
      provider: LLMProviders.OpenAI, id: 'rs_lookup', text: '',
      encryptedContent: 'encrypted-lookup'
    }]
    const callModel = vi.fn()
      .mockResolvedValueOnce({ reasoning, reasoningItems,
        toolCalls: [toolCall('lookup', CALLABLE_TOOL_NAME, { query: 'weather' })] })
      .mockImplementationOnce(async (messages) => {
        expect(messages).toContainEqual(expect.objectContaining({ role: 'assistant', reasoning, reasoningItems }))
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
    const catalog = createCatalog()
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Download all August invoices.' },
      {
        role: 'user',
        content: 'Include September too. Keep the original filenames.'
      }
    ]

    catalog.tools.push({
      type: 'function',
      function: {
        name: AGENT_TOOLKIT_LOADER_NAME,
        description: 'The full discovery catalog is unrelated to completion review.',
        parameters: { type: 'object', properties: {} }
      }
    })
    const initialExecutionHistory = [{
      function: callable.qualifiedName, status: 'success',
      observation: 'Verified invoice-0003.pdf. Other requested invoices remain.',
      requestedToolInput: JSON.stringify({ query: 'invoice-0003' })
    }]
    const progressMessage =
      'I downloaded one invoice. The remaining invoices are not downloaded yet.'
    const onProgressMessage = vi.fn()
    const callModel = vi.fn()
      .mockResolvedValueOnce({ textContent: progressMessage })
      .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'continue', reason: 'Invoice 0003 is verified. Download the remaining August and September invoices.' }) })
      .mockImplementationOnce(async () => {
        // Settle the displayed message before the next call resets its draft.
        expect(onProgressMessage).toHaveBeenCalledExactlyOnceWith(
          progressMessage
        )

        return {
          toolCalls: [
            toolCall('remaining', CALLABLE_TOOL_NAME, {
              query: 'remaining-invoices'
            })
          ]
        }
      })
      .mockResolvedValueOnce({ textContent: 'All requested invoices are downloaded and verified.' })
      .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'complete', reason: 'All requested invoices have verified files.' }) })
    const executeFunction = vi.fn(async () => ({ execution: {
      function: callable.qualifiedName, status: 'success',
      observation: 'Remaining August and September invoice files verified.',
      requestedToolInput: JSON.stringify({ query: 'remaining-invoices' })
    } }))
    const result = await runAgentLoopWithCompletionReview({
      transcript: structuredClone(transcript),
      catalog, initialExecutionHistory, callModel, executeFunction,
      onProgressMessage,
      loadAgentSkill: async () => null
    })

    expect(result.intent).toBe('answer')
    expect(result.answer).toBe('All requested invoices are downloaded and verified.')
    expect(onProgressMessage).toHaveBeenCalledExactlyOnceWith(progressMessage)
    expect(executeFunction).toHaveBeenCalledExactlyOnceWith(
      callable,
      JSON.stringify({ query: 'remaining-invoices' }),
      undefined,
      'remaining'
    )
    expect(callModel.mock.calls[1]?.[1]).toEqual([])
    expect(callModel.mock.calls[1]?.[2]).toMatchObject({ isCompletionReview: true })
    expect(
      callModel.mock.calls[1]?.[0].slice(0, transcript.length)
    ).toEqual(transcript)
    const review = JSON.parse(callModel.mock.calls[1]?.[0].at(-1).content)

    expect(review.available_tool_contracts).toEqual([catalog.tools[0]!.function])
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
      callModel: vi.fn()
        .mockResolvedValueOnce({ textContent: 'Done.' })
        .mockResolvedValueOnce(review)
        .mockResolvedValueOnce(review),
      executeFunction, loadAgentSkill: async () => null
    })
    expect(result.intent).toBe('error')
    expect(result.answer).toContain('completion check failed')
    expect(executeFunction).not.toHaveBeenCalled()
  })

  it('retries an unusable completion review before rejecting the proposed answer', async () => {
    const callModel = vi.fn()
      .mockResolvedValueOnce({ textContent: 'The OCR text is LEON AI 42.' })
      .mockRejectedValueOnce(new Error('Provider rejected structured output'))
      .mockResolvedValueOnce({ textContent: JSON.stringify({ status: 'complete', reason: 'The OCR result is included.' }) })
    const result = await runAgentLoopWithCompletionReview({
      transcript: [{ role: 'user', content: 'Read the image text.' }], catalog: createCatalog(),
      initialExecutionHistory: [{
        function: callable.qualifiedName, status: 'success', observation: 'OCR returned LEON AI 42.'
      }],
      callModel, executeFunction: vi.fn(), loadAgentSkill: async () => null
    })
    expect(result.intent).toBe('answer')
    expect(result.answer).toBe('The OCR text is LEON AI 42.')
    expect(callModel).toHaveBeenCalledTimes(3)
    expect(callModel.mock.calls[1]?.[2]).toMatchObject({ useReviewSchema: true })
    expect(callModel.mock.calls[2]?.[2]).toMatchObject({ useReviewSchema: false })
    expect(callModel.mock.calls[2]?.[0].at(-1)?.content).toContain('previous completion review response was unusable')
  })

  it('checks unfinished plans and enters the finishing pass after rejected completion', async () => {
    const prepareContinuation = vi.fn(async (state) => state.transcript)
    const onPlanUpdated = vi.fn()
    const completedStep = {
      label: 'Find the files',
      status: 'completed' as const,
      details: 'The full inventory is saved.'
    }
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
      initialTrackedSteps: [completedStep, { label: 'Verify the files', status: 'pending' }],
      maxIterations: 3, finishingIterations: 2, callModel, prepareContinuation,
      executeFunction: vi.fn(), loadAgentSkill: async () => null, onPlanUpdated
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
    expect(result.trackedSteps).toEqual([
      completedStep,
      { label: 'Verify the files', status: 'completed' }
    ])
    expect(onPlanUpdated).toHaveBeenCalledExactlyOnceWith(result.trackedSteps)
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

  it('codes directly and keeps owner-selected delegation available', () => {
    const skill = fs.readFileSync('skills/agent/coding/SKILL.md', 'utf8')

    expect(AGENT_SYSTEM_PROMPT.indexOf('<coding>')).toBeGreaterThanOrEqual(0)
    expect(AGENT_SYSTEM_PROMPT.indexOf('<coding>')).toBeLessThan(
      AGENT_SYSTEM_PROMPT.indexOf('<tool_policy>')
    )

    expect(AGENT_SYSTEM_PROMPT).toContain(
      'Handle coding directly. Load the coding Agent Skill when enabled.'
    )
    expect(AGENT_SYSTEM_PROMPT).toContain(
      'Delegate only when the owner requests or prefers an external coding agent'
    )
    expect(skill).toContain('submitting a prompt is not completion')
    expect(skill).toContain(
      'If delegation is unavailable, explain briefly and continue directly'
    )
    expect(skill).toContain(
      'analysis is not authorization to edit, commit, push or publish'
    )
    expect(AGENT_SYSTEM_PROMPT).not.toContain('Codex')
    expect(AGENT_SYSTEM_PROMPT).not.toContain('Ghostty')
  })

  it('loads collection tracking after plan initialization', async () => {
    const catalog = createCatalog()
    const steps = [{ label: 'Inspect requested collection', status: 'in_progress' }]
    let turn = 0

    catalog.tools.push(createAgentPlanTool(AGENT_PLAN_TOOL_NAME))

    await runAgentLoop({
      transcript: [{ role: 'user', content: 'Retrieve the requested documents.' }],
      catalog,
      callModel: async (_messages, tools) => {
        const planTool = tools.find(
          (tool) => tool.function.name === AGENT_PLAN_TOOL_NAME
        )
        const schema = JSON.stringify(planTool?.function.parameters)

        turn += 1

        if (turn === 1) {
          expect(schema).not.toContain('"collection"')

          return {
            toolCalls: [
              toolCall('initialize-plan', AGENT_PLAN_TOOL_NAME, { steps })
            ]
          }
        }

        expect(schema).toContain('"collection"')
        expect(schema).toContain('"enumeration"')

        return {
          toolCalls: [
            toolCall('clarify', AGENT_CLARIFICATION_TOOL_NAME, {
              question: 'Which account contains these documents?'
            })
          ]
        }
      },
      executeFunction: vi.fn(),
      loadAgentSkill: async () => null
    })

    expect(turn).toBe(2)
    expect(AGENT_PLAN_GUIDANCE).toContain(
      'Immediately after a milestone is verified, call update_plan'
    )
    expect(AGENT_PLAN_GUIDANCE).toContain(
      'never defer multiple historical completions until final reconciliation'
    )
    expect(AGENT_SYSTEM_PROMPT).not.toContain('Enumerate stable source identities')
  })

  it.each(['active', 'completed', 'absent'] as const)(
    'reminds only stale active plans without changing evidence or blocking tools (%s)',
    async (state) => {
      const steps = state === 'absent' ? [] : [{
        label: 'Resolve source items',
        status: state === 'active' ? 'in_progress' as const : 'completed' as const
      }]
      const onPlanUpdated = vi.fn()
      const reminders: number[] = []
      let turn = 0
      const catalog = createCatalog()

      catalog.tools.push(createAgentPlanTool(AGENT_PLAN_TOOL_NAME))

      const result = await runAgentLoop({
        transcript: [{ role: 'user', content: 'Resolve these items.' }],
        catalog,
        initialTrackedSteps: steps,
        callModel: async (_messages, tools, options) => {
          const planTool = tools.find(
            (tool) => tool.function.name === AGENT_PLAN_TOOL_NAME
          )
          const schema = JSON.stringify(planTool?.function.parameters)

          expect(schema.includes('"collection"')).toBe(state !== 'absent')

          turn += 1
          if (options.requiresPlanReconciliation) {
            reminders.push(turn)
          }
          if (turn === 10) {
            return {
              toolCalls: [
                toolCall('clarify', AGENT_CLARIFICATION_TOOL_NAME, {
                  question: 'Which of the two matching editions do you want?'
                })
              ]
            }
          }

          return {
            toolCalls: [
              toolCall(`lookup-${turn}`, CALLABLE_TOOL_NAME, {
                query: `item-${turn}`
              })
            ]
          }
        },
        executeFunction: async (_callable, toolInput) => ({ execution: {
          function: callable.qualifiedName, status: 'success',
          requestedToolInput: toolInput, observation: 'Input delivered; outcome not yet verified.'
        } }),
        loadAgentSkill: async () => null, onPlanUpdated
      })
      expect(reminders).toEqual(state === 'active' ? [5, 9] : [])
      expect(result.trackedSteps).toEqual(steps)
      expect(onPlanUpdated).not.toHaveBeenCalled()
      expect(result.executionHistory).toHaveLength(9)
    }
  )

  it('resets plan reminders on accepted updates but not rejected updates', async () => {
    const steps = [{ label: 'Resolve source items', status: 'in_progress' as const }]
    const reminders: number[] = []
    let turn = 0
    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Resolve these items.' }],
      catalog: createCatalog(), initialTrackedSteps: steps,
      callModel: async (_messages, _tools, options) => {
        turn += 1
        if (options.requiresPlanReconciliation) reminders.push(turn)
        if (turn === 4) return { toolCalls: [toolCall('accepted', AGENT_PLAN_TOOL_NAME, {
          steps: [{ ...steps[0], details: 'Still resolving the final source item.' }]
        })] }
        if (turn === 8) return { toolCalls: [toolCall('rejected', AGENT_PLAN_TOOL_NAME, { steps: [] })] }
        if (turn === 10) return { toolCalls: [toolCall('clarify', AGENT_CLARIFICATION_TOOL_NAME, {
          question: 'Which edition do you want?'
        })] }
        return { toolCalls: [toolCall(`lookup-${turn}`, CALLABLE_TOOL_NAME, { query: `item-${turn}` })] }
      },
      executeFunction: async (_callable, toolInput) => ({ execution: {
        function: callable.qualifiedName, status: 'success',
        requestedToolInput: toolInput, observation: 'Inspected source.'
      } }),
      loadAgentSkill: async () => null
    })
    expect(reminders).toEqual([10])
    expect(result.trackedSteps).toEqual([{ ...steps[0], details: 'Still resolving the final source item.' }])
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
      'List files on ~/Desktop',
      'list-desktop'
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

  it('stops immediately when a tool requires owner action', async () => {
    const callModel = vi.fn().mockResolvedValue({
      toolCalls: [
        toolCall('owner-action-1', CALLABLE_TOOL_NAME, { query: 'Leon' })
      ]
    })

    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Open the browser.' }],
      catalog: createCatalog(),
      callModel,
      executeFunction: async () => ({
        execution: {
          function: callable.qualifiedName,
          status: 'error',
          observation: 'Browser authorization is required.'
        },
        handoffSignal: {
          intent: 'clarification',
          draft: 'Enable browser authorization, then tell me to retry.'
        }
      }),
      loadAgentSkill: async () => null
    })

    expect(callModel).toHaveBeenCalledOnce()
    expect(result.intent).toBe('clarification')
    expect(result.answer).toBe(
      'Enable browser authorization, then tell me to retry.'
    )
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
            function: 'file_system.file.readToolArtifact',
            status: 'success',
            observation: 'Artifact prefix read.',
            requestedToolInput: previousInput
          }
        ],
        'file_system.file.readToolArtifact',
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

  it('discovers function summaries before selectively loading guidance and preserves the selection on resume', async () => {
    coreMocks.getFlattenedTools.mockReturnValue(['first', 'other'].map((toolId) => ({
      toolkitId: 'test', toolkitName: 'Test', toolkitDescription: 'Test discovery.',
      toolkitProgressiveGuidance: 'Shared toolkit instructions.', toolId,
      toolName: toolId, toolDescription: 'Tool routing summary.',
      toolProgressiveGuidance: `Shared ${toolId} instructions.`
    })))
    coreMocks.getToolFunctions.mockReturnValue(Object.fromEntries(['read', 'write', 'inspect'].map((name) => [name, {
      description: `Summary for ${name}.`,
      progressive_guidance: `Detailed ${name} instructions.`,
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }])))
    const catalog = buildAgentToolCatalog()
    expect(JSON.stringify(catalog.tools)).not.toContain('Detailed')
    expect(JSON.stringify(catalog.tools)).not.toContain('Summary for read')
    let turn = 0
    const loadToolkitContext = vi.fn(() => 'Toolkit context files.')
    await runAgentLoop({
      transcript: [{ role: 'user', content: 'Read something.' }], catalog,
      callModel: async (messages, tools) => {
        turn += 1
        if (turn === 1) return { toolCalls: [toolCall('discover', AGENT_TOOLKIT_LOADER_NAME, {
          toolkit_id: 'test', tool_id: 'first'
        })] }
        if (turn === 2) {
          expect(catalog.functionsByToolName.size).toBe(0)
          const loader = tools.find((tool) => tool.function.name === AGENT_TOOLKIT_LOADER_NAME)
          expect(loader?.function.parameters).toMatchObject({
            properties: { functions: { items: { enum: expect.arrayContaining(['first.read', 'first.inspect']) } } }
          })
          expect(JSON.stringify(loader?.function.parameters)).not.toContain('first.first')
          expect(JSON.stringify(tools)).toContain('first.read: Summary for read.')
          expect(JSON.stringify(tools)).not.toContain('Detailed')
          expect(buildAgentProgressiveGuidanceSystemPrompt(catalog)).toContain('Shared first instructions.')
          expect(buildAgentProgressiveGuidanceSystemPrompt(catalog)).not.toContain('Shared other instructions.')
          const discoveryResume = buildAgentToolCatalog(null, catalog.loadedToolkitIds, true, [], catalog.loadedToolNames)
          expect(discoveryResume.functionsByToolName.size).toBe(0)
          expect(buildAgentProgressiveGuidanceSystemPrompt(discoveryResume)).toBe(buildAgentProgressiveGuidanceSystemPrompt(catalog))
          return { toolCalls: [toolCall('invalid', AGENT_TOOLKIT_LOADER_NAME, {
            toolkit_id: 'test', functions: ['first.read', 'missing.write']
          })] }
        }
        if (turn === 3) {
          expect(messages.at(-1)?.content).toContain('rejected')
          expect(catalog.functionsByToolName.size).toBe(0)
          return { toolCalls: [toolCall('select', AGENT_TOOLKIT_LOADER_NAME, {
            toolkit_id: 'test', functions: ['first.read', 'first.inspect']
          })] }
        }
        expect(catalog.functionsByToolName.size).toBe(2)
        expect(JSON.stringify(tools)).toContain('Detailed read instructions.')
        expect(JSON.stringify(tools)).toContain('Detailed inspect instructions.')
        expect(JSON.stringify(tools)).not.toContain('Detailed write instructions.')
        expect(buildAgentProgressiveGuidanceSystemPrompt(catalog)).not.toContain('Detailed read instructions.')
        expect(buildAgentProgressiveGuidanceSystemPrompt(catalog)).not.toContain('Shared other instructions.')
        if (turn === 4) return { toolCalls: [toolCall('reuse', AGENT_TOOLKIT_LOADER_NAME, {
          toolkit_id: 'test', functions: ['first.read']
        })] }
        expect(tools.filter((tool) => tool.function.name === 'test__first__read')).toHaveLength(1)
        return { textContent: 'Ready.' }
      },
      executeFunction: async () => { throw new Error('Discovery must not execute functions') },
      loadToolkitContext,
      loadAgentSkill: async () => null
    })
    expect(turn).toBe(5)
    expect(loadToolkitContext).toHaveBeenCalledTimes(1)
    const selected = [...catalog.functionsByToolName.values()].map((fn) => fn.qualifiedName)
    const resumed = buildAgentToolCatalog(null, catalog.loadedToolkitIds, true, selected, catalog.loadedToolNames)
    expect([...resumed.functionsByToolName.keys()]).toEqual([...catalog.functionsByToolName.keys()])
    expect(buildAgentProgressiveGuidanceSystemPrompt(resumed)).toBe(buildAgentProgressiveGuidanceSystemPrompt(catalog))
    expect(JSON.stringify(resumed.tools)).not.toContain('Detailed write instructions.')
    const eager = buildAgentToolCatalog(null, [], false)
    expect(eager.functionsByToolName.size).toBe(6)
    expect(JSON.stringify(eager.tools)).toContain('Detailed write instructions.')
    expect(eager.tools.some((tool) => tool.function.name === AGENT_TOOLKIT_LOADER_NAME)).toBe(false)
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
        toolkitId: 'document',
        toolkitName: 'Document',
        toolkitDescription: 'Read and create local documents.',
        toolId: 'document',
        toolName: 'Document',
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
      getWeather: {
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
            'weather__openmeteo__getWeather'
          )
          expect(tools.map((tool) => tool.function.name)).not.toContain(
            AGENT_TOOLKIT_LOADER_NAME
          )
          return {
            toolCalls: [
              toolCall(
                'weather-call',
                'weather__openmeteo__getWeather',
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
      loadedFunctionNames: ['communication.mail.send'],
      loadedToolNames: ['communication.mail'],
      transcript: [
        { role: 'assistant', content: 'Recipient lookup complete.' }
      ],
      activeSkillId: null
    })

    expect(isAgentLoopContinuationStateValid(state)).toBe(true)
    expect(state.transcript).not.toBe(undefined)
    expect(state.executionHistory).toHaveLength(1)
    expect(state.loadedToolkitIds).toEqual(['communication'])
    expect(state.loadedFunctionNames).toEqual(['communication.mail.send'])
    expect(state.loadedToolNames).toEqual(['communication.mail'])
    expect(isAgentLoopContinuationStateValid({ ...state, loadedFunctionNames: undefined })).toBe(true)
    expect(state.transcript).toHaveLength(1)
    expect(state.transcript[0]?.content).toContain(
      'Recipient lookup complete.'
    )
    expect(state.transcript[0]?.content).not.toContain('Which recipient?')
  })
})


describe('agent automatic compaction', () => {
  beforeEach(() => {
    coreMocks.prompt.mockReset()
  })

  afterEach(() => {
    coreMocks.prompt.mockReset()
  })

  it('lets OpenAI decide when to compact and passes returned context to the loop', async () => {
    const source: AgentToolTranscriptMessage[] = [{ role: 'user', content: 'Evidence '.repeat(60_000) }]
    const context = {
      provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol', binding: 'connection',
      output: [{ type: 'compaction', id: 'cmp', encrypted_content: 'opaque' }],
      estimatedTokens: 500, sourceTranscript: source
    }
    coreMocks.prompt.mockResolvedValueOnce({ output: 'Done.', compactionContext: context, usedInputTokens: 100_000, usedOutputTokens: 400 })
    vi.spyOn(CONFIG_STATE.getModelState(), 'getAgentProvider').mockReturnValue(LLMProviders.OpenAI)
    vi.spyOn(CONFIG_STATE.getModelState(), 'getAgentTarget').mockReturnValue({ provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol' })
    vi.spyOn(CONFIG_STATE.getModelSettingsState(), 'getSettings').mockReturnValue({ reasoning: 'on', speed: 'auto' })
    const duty = new ReActLLMDuty({ input: 'Continue the task.' })
    Object.assign(duty, { writeAgentPromptLog: vi.fn() })

    const result = await duty['callAgentModel'](source, 'Follow the request.', [], { isRecoveryAttempt: false })

    expect(coreMocks.prompt).toHaveBeenCalledOnce()
    expect(coreMocks.prompt.mock.calls[0]![0]).toEqual(source)
    expect(result?.compactionContext).toEqual(context)
    expect(duty['totalInputTokens']).toBe(100_000)
    expect(duty['totalOutputTokens']).toBe(400)
    expect(duty['safeJSONStringify'](context)).not.toContain('Evidence ')
    expect(duty['safeJSONStringify'](context)).not.toContain('opaque')
  })

  it('recovers from source evidence and disables automatic compaction after provider rejection', async () => {
    vi.spyOn(CONFIG_STATE.getModelState(), 'getAgentProvider').mockReturnValue(LLMProviders.OpenAI)
    vi.spyOn(CONFIG_STATE.getModelState(), 'getAgentTarget').mockReturnValue({ provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol' })
    vi.spyOn(CONFIG_STATE.getModelSettingsState(), 'getSettings').mockReturnValue({ reasoning: 'on', speed: 'auto' })
    const transcript: AgentToolTranscriptMessage[] = [{ role: 'user', content: 'Keep exact evidence.' }]
    coreMocks.prompt.mockResolvedValueOnce(null)
    coreMocks.consumeLastProviderErrorMessage.mockReturnValueOnce('Unsupported context_management')
    const duty = new ReActLLMDuty({ input: 'Continue.' })
    Object.assign(duty, { writeAgentPromptLog: vi.fn() })

    await expect(duty['callAgentModel'](transcript, 'Follow the request.', [], { isRecoveryAttempt: false })).rejects.toMatchObject({ canRetryWithCompaction: true })
    coreMocks.prompt.mockResolvedValue({ output: 'Done.' })
    await duty['callAgentModel'](transcript, 'Follow the request.', [], { isRecoveryAttempt: true, isContextRecoveryAttempt: true })
    await duty['callAgentModel'](transcript, 'Follow the request.', [], { isRecoveryAttempt: false })
    expect(coreMocks.prompt.mock.calls.slice(1).every(([, params]) => params.disableContextCompaction)).toBe(true)
  })

  it.each([false, true])('records compacted responses safely when tool calls are deferred ($0)', async (deferred) => {
    const calls = Array.from({ length: deferred ? AGENT_MAX_PARALLEL_TOOL_CALLS + 1 : 1 }, (_, index) =>
      toolCall(`lookup-compact-${index}`, CALLABLE_TOOL_NAME, { query: String(index) })
    )
    const call = calls[0]!
    const context = {
      provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol', binding: 'connection',
      output: [{ type: 'compaction', id: 'cmp', encrypted_content: 'opaque' }, ...calls.map((item) => ({ type: 'function_call', call_id: item.id }))],
      estimatedTokens: 100, sourceTranscript: [{ role: 'user' as const, content: 'Find Leon.' }, { role: 'assistant' as const, content: '', toolCalls: calls }]
    }
    const callModel = vi.fn().mockResolvedValueOnce({ toolCalls: calls, compactionContext: context })
      .mockResolvedValueOnce({ textContent: 'Leon found.' })
    const result = await runAgentLoop({
      transcript: [{ role: 'user', content: 'Find Leon.' }], catalog: createCatalog(), callModel,
      executeFunction: async () => ({ execution: { function: callable.qualifiedName, status: 'success', observation: 'Leon found.', requestedToolInput: '{}' } }),
      loadAgentSkill: async () => null
    })

    if (deferred) {
      expect(result.transcript[0]).toEqual({ role: 'user', content: 'Find Leon.' })
      expect(result.transcript[1]).not.toHaveProperty('compactionContext')
      expect(result.transcript.filter((message) => message.role === 'tool')).toHaveLength(AGENT_MAX_PARALLEL_TOOL_CALLS)
    } else {
      expect(result.transcript[0]).toMatchObject({ role: 'assistant', compactionContext: context })
      expect(result.transcript[1]).toMatchObject({ role: 'tool', toolCallId: call.id })
      expect(result.transcript.filter((message) => message.role === 'user')).toHaveLength(0)
    }
    expect(JSON.stringify(result.transcript)).toContain('Leon found.')
  })

  it('does not dispatch a request after owner cancellation', async () => {
    const controller = new AbortController()
    const reason = new Error('Owner canceled')
    controller.abort(reason)
    const duty = new ReActLLMDuty({ input: 'Continue.', signal: controller.signal })

    await expect(duty['callAgentModel']([], 'Follow the request.', [], { isRecoveryAttempt: false })).rejects.toBe(reason)
    expect(coreMocks.prompt).not.toHaveBeenCalled()
  })
})

describe('model response status', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    coreMocks.prompt.mockReset()

    const modelState = CONFIG_STATE.getModelState()
    vi.spyOn(modelState, 'getAgentProvider').mockReturnValue(LLMProviders.OpenAI)
    vi.spyOn(modelState, 'getAgentTarget').mockReturnValue({
      provider: LLMProviders.OpenAI, model: 'gpt-6-sol'
    })
    vi.spyOn(CONFIG_STATE.getModelSettingsState(), 'getSettings').mockReturnValue({
      reasoning: 'on', speed: 'auto'
    })
    vi.spyOn(LogHelper, 'warning').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const statuses = (): ModelResponseStatus[] => coreMocks.emitToChatClients.mock.calls
    .filter(([event]) => event === 'model-response-status')
    .map(([, status]) => status)

  it('retains the prepared prompt estimate when an adapter reports no input usage', async () => {
    coreMocks.prompt.mockResolvedValueOnce({
      output: 'Done.',
      usedInputTokens: 0
    })
    const duty = new ReActLLMDuty({ input: 'Inspect the files.' })
    Object.assign(duty, { writeAgentPromptLog: vi.fn() })

    await duty['callAgentModel']([], 'Follow the request.', [], {
      isRecoveryAttempt: false
    })

    const preparedUsage = statuses()[0]?.contextUsage

    expect(preparedUsage?.contextUsedTokens).toBeGreaterThan(0)
    expect(preparedUsage?.contextUsageEstimated).toBe(true)
    expect(statuses().at(-1)?.contextUsage).toEqual(preparedUsage)
  })

  it('keeps latest prompt occupancy isolated per session and active model', async () => {
    vi.mocked(CONFIG_STATE.getModelState().getAgentTarget).mockRestore()
    coreMocks.prompt
      .mockResolvedValueOnce({ output: 'First answer.', usedInputTokens: 105_000 })
      .mockResolvedValueOnce({ output: 'Second answer.', usedInputTokens: 200_000 })
      .mockResolvedValueOnce({ output: 'Continued answer.', usedInputTokens: 42_000 })
    const firstContext = {
      sessionId: 'first-session',
      modelTarget: 'openai/gpt-6.1-sol'
    }
    const secondContext = {
      sessionId: 'second-session',
      modelTarget: 'minimax/MiniMax-M3'
    }
    const first = new ReActLLMDuty({ input: 'First request.' })
    const second = new ReActLLMDuty({ input: 'Second request.' })
    Object.assign(first, { writeAgentPromptLog: vi.fn() })
    Object.assign(second, { writeAgentPromptLog: vi.fn() })
    const callOptions = { isRecoveryAttempt: false }

    await Promise.all([
      runWithConversationSession(firstContext, () =>
        first['callAgentModel']([], 'Follow the first request.', [], callOptions)
      ),
      runWithConversationSession(secondContext, () =>
        second['callAgentModel']([], 'Follow the second request.', [], callOptions)
      )
    ])

    expect(statuses().find((status) => status.sessionId === firstContext.sessionId)
      ?.contextUsage?.contextUsageEstimated).toBe(true)
    expect(statuses().findLast((status) => status.sessionId === firstContext.sessionId)
      ?.contextUsage).toEqual({
      contextUsedTokens: 105_000,
      contextWindowTokens: 1_050_000,
      contextUsagePercent: 10,
      contextUsageEstimated: false
    })
    expect(statuses().findLast((status) => status.sessionId === secondContext.sessionId)
      ?.contextUsage).toEqual({
      contextUsedTokens: 200_000,
      contextWindowTokens: 1_000_000,
      contextUsagePercent: 20,
      contextUsageEstimated: false
    })

    await runWithConversationSession(firstContext, () =>
      first['callAgentModel']([], 'Follow the compacted transcript.', [], callOptions)
    )

    expect(first['contextUsage']?.contextUsagePercent).toBe(4)
    expect(first['totalInputTokens']).toBe(147_000)
    expect(second['contextUsage']?.contextUsagePercent).toBe(20)
    expect(coreMocks.prompt).toHaveBeenCalledTimes(3)
  })

  it.each([false, true])('reports observed stream activity without adding chat history (review=%s)', async (review) => {
    let finish!: (result: { output: string }) => void
    let params!: CompletionParams
    coreMocks.prompt.mockImplementationOnce((_messages, input) => {
      params = input
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const duty = new ReActLLMDuty({ input: 'Inspect the files.' })
    Object.assign(duty, { writeAgentPromptLog: vi.fn() })
    const pending = duty['callAgentModel']([], 'Follow the request.', [], {
      isRecoveryAttempt: false, isCompletionReview: review
    })

    try {
      expect(statuses().at(-1)?.state).toBe(ModelResponseState.Waiting)
      params.onStreamEvent?.({ type: 'stream-open' })
      params.onStreamEvent?.({ type: 'reasoning-start' })
      await vi.advanceTimersByTimeAsync(AGENT_TOOL_CALL_DIAGNOSIS_DELAY_MS)
      expect(statuses().map((status) => status.state)).toEqual([
        ModelResponseState.Waiting, ModelResponseState.Connected, ModelResponseState.Reasoning
      ])
      expect(duty['responseTraceCollector'].snapshot({}).progressMessages).toBeUndefined()
      expect(coreMocks.emitAnswerToChatClients.mock.calls.some(([payload]) =>
        payload.historyMode === 'system_widget'
      )).toBe(false)
      expect(LogHelper.warning).toHaveBeenCalledWith(
        expect.stringContaining('approximate input tokens=')
      )
      expect(coreMocks.prompt).toHaveBeenCalledOnce()
    } finally {
      finish({ output: 'Done.' })
      await pending
    }
    expect(statuses().at(-1)?.state).toBe(ModelResponseState.Completed)
    expect(new Set(statuses().map((status) => status.requestId)).size).toBe(1)
  })

  it.each(['text', 'tool-input', 'internal-tool', 'completed', 'failed', 'canceled'])(
    'clears model waiting on %s and ignores late stream events', async (state) => {
      let finish!: (result: { output: string }) => void
      let fail!: (error: Error) => void
      let params!: CompletionParams
      coreMocks.prompt.mockImplementationOnce((_messages, input) => {
        params = input
        return new Promise((resolve, reject) => {
          finish = resolve
          fail = reject
        })
      })
      const controller = new AbortController()
      const duty = new ReActLLMDuty({ input: 'Inspect files.', signal: controller.signal })
      Object.assign(duty, { writeAgentPromptLog: vi.fn() })
      const pending = duty['callAgentModel']([], 'Follow the request.', [], {
        isRecoveryAttempt: false
      }).then(() => null, (error) => error)
      try {
        if (state === 'text') {
          params.onToken?.('Found the files.')
        } else if (state === 'tool-input') {
          params.onStreamEvent?.({ type: 'tool-input-start' })
        } else if (state === 'internal-tool') {
          params.onToolCall?.(toolCall('plan', AGENT_PLAN_TOOL_NAME, {}))
        } else if (state === 'completed') {
          finish({ output: 'Done.' })
          await pending
        } else if (state === 'failed') {
          fail(new Error('Provider failed.'))
          await pending
        } else {
          controller.abort(new Error('Owner canceled.'))
        }
        expect(statuses().at(-1)?.state).toBe(ModelResponseState.Completed)
        const count = statuses().length
        params.onStreamEvent?.({ type: 'reasoning-start' })
        await vi.advanceTimersByTimeAsync(AGENT_TOOL_CALL_WAIT_NOTICE_DELAY_MS)
        expect(statuses()).toHaveLength(count)
      } finally {
        finish({ output: 'Done.' })
        const error = await pending
        if (state === 'canceled') {
          expect(error).toBe(controller.signal.reason)
        }
      }
    }
  )

  it('reports retries without resetting the total elapsed time', async () => {
    let finish!: (result: { output: string }) => void
    let params!: CompletionParams
    coreMocks.prompt.mockImplementationOnce((_messages, input) => {
      params = input
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const duty = new ReActLLMDuty({ input: 'Inspect files.' })
    Object.assign(duty, { writeAgentPromptLog: vi.fn() })
    const pending = duty['callAgentModel']([], 'Follow the request.', [], {
      isRecoveryAttempt: false
    })
    const attempt = {
      attemptId: 'attempt-1', startedAt: Date.now(), provider: LLMProviders.OpenAI,
      duty: LLMDuties.ReAct, transport: 'http' as const, outcome: 'started',
      elapsedMs: 0, inferenceTimeoutMs: 120_000, streamIdleTimeoutMs: 30_000,
      lastEvent: 'dispatched'
    }
    const startedAt = Date.now()
    try {
      params.onAttempt?.(attempt)
      params.onStreamEvent?.({ type: 'tool-input-start' })
      params.onAttempt?.({ ...attempt, outcome: 'failed', failureKind: CompletionFailureKind.Timeout })
      expect(statuses().at(-1)).toMatchObject({
        state: ModelResponseState.Retrying, retryReason: CompletionFailureKind.Timeout
      })
      await vi.advanceTimersByTimeAsync(1_000)
      params.onAttempt?.({ ...attempt, attemptId: 'attempt-2', startedAt: Date.now() })
      expect(statuses().at(-1)).toMatchObject({
        state: ModelResponseState.Waiting, startedAt, attempt: 2,
        deadlineAt: Date.now() + AGENT_MODEL_RESPONSE_TIMEOUT_MS,
        retryReason: CompletionFailureKind.Timeout, lastActivityAt: null
      })
      params.onStreamEvent?.({ type: 'stream-open' })
      expect(statuses().at(-1)?.state).toBe(ModelResponseState.Connected)
      expect(statuses().at(-1)?.lastActivityAt).toBe(Date.now())
    } finally {
      finish({ output: 'Done.' })
      await pending
    }
  })

  it.each(['text', 'reasoning', 'tool-input', 'review'])(
    'allows productive %s beyond the initial response deadline', async (output) => {
      let params!: CompletionParams
      let finish!: (result: { output: string }) => void
      coreMocks.prompt.mockImplementationOnce((_messages, input) => {
        params = input
        return new Promise((resolve) => {
          finish = resolve
        })
      })
      const duty = new ReActLLMDuty({ input: 'Build the deliverable.' })
      Object.assign(duty, { writeAgentPromptLog: vi.fn() })
      const pending = duty['callAgentModel']([], 'Follow the request.', [], {
        isRecoveryAttempt: false,
        isCompletionReview: output === 'review'
      })

      try {
        for (
          let elapsed = 0;
          elapsed < AGENT_MODEL_RESPONSE_TIMEOUT_MS + 60_000;
          elapsed += 20_000
        ) {
          await vi.advanceTimersByTimeAsync(20_000)
          if (output === 'tool-input') {
            params.onStreamEvent?.({ type: 'tool-input-delta' })
          } else if (output === 'reasoning') {
            params.onReasoningToken?.('Planning the next step.')
          } else {
            params.onToken?.('Generated content.')
          }
        }

        expect(params.cancellationSignal?.aborted).toBe(false)
        expect(coreMocks.prompt).toHaveBeenCalledOnce()
        if (output === 'review') {
          expect(coreMocks.emitAnswerToChatClients).not.toHaveBeenCalled()
        }
      } finally {
        finish({ output: 'Done.' })
        await pending
      }
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('caps productive generation and ignores output after cancellation', async () => {
    let params!: CompletionParams
    let finish!: (result: { output: string }) => void
    coreMocks.prompt.mockImplementationOnce((_messages, input: CompletionParams) => {
      params = input
      return new Promise((resolve, reject) => {
        finish = resolve
        input.cancellationSignal?.addEventListener('abort', () => {
          reject(input.cancellationSignal?.reason)
        }, { once: true })
      })
    })
    const duty = new ReActLLMDuty({ input: 'Build the deliverable.' })
    Object.assign(duty, { writeAgentPromptLog: vi.fn() })
    const pending = duty['callAgentModel']([], 'Follow the request.', [], {
      isRecoveryAttempt: false
    }).then(() => null, (error) => error)

    for (
      let elapsed = 0;
      elapsed < AGENT_MODEL_RESPONSE_MAX_DURATION_MS;
      elapsed += 20_000
    ) {
      params.onToken?.('Generated content.')
      await vi.advanceTimersByTimeAsync(20_000)
    }

    expect(await pending).toBeInstanceOf(AgentModelResponseTimeoutError)
    const count = coreMocks.emitAnswerToChatClients.mock.calls.length
    params.onToken?.('Late output')
    params.onReasoningToken?.('Late reasoning')
    params.onStreamEvent?.({ type: 'transport-activity' })
    finish({ output: 'Late result' })
    expect(coreMocks.emitAnswerToChatClients).toHaveBeenCalledTimes(count)
    expect(coreMocks.prompt).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['timeout', 'empty'])('bounds %s retries and silent reasoning while saving progress without another inference', async (firstResponse) => {
    vi.spyOn(LogHelper, 'timeEnd').mockImplementation(() => {})
    const attempts: CompletionParams[] = []
    const runChatCompletion = vi.fn((_history, params: CompletionParams) => {
      attempts.push(params)
      params.onStreamEvent?.({ type: 'stream-open' })
      params.onStreamEvent?.({ type: 'response-metadata' })
      if (attempts.length === 1 && firstResponse === 'empty') {
        params.onStreamEvent?.({ type: 'finish' })
        return Promise.resolve({ data: {
          choices: [{ message: { content: '' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0 }
        } })
      }
      if (attempts.length === 2) {
        params.onStreamEvent?.({ type: 'reasoning-start' })
      }
      return new Promise(() => {})
    })
    coreMocks.prompt.mockImplementation((history, params) => runCompletionAttempt(
      { modelName: 'test-model', runChatCompletion }, LLMProviders.OpenAI, history,
      { ...params, data: params.data ?? null, remoteProviderErrorRetries: 0 } as PreparedCompletionParams,
      'deadline-test', (retryParams) => coreMocks.prompt(history, retryParams), vi.fn()
    ))
    const duty = new ReActLLMDuty({ input: 'Verify the saved results.' })
    Object.assign(duty, { writeAgentPromptLog: vi.fn() })
    const priorExecution = {
      function: 'example.verify', status: 'success', observation: 'Verified the first result.'
    }
    const trackedSteps = [{ label: 'Publish verified results', status: 'in_progress' as const }]
    const pending = runAgentLoopWithCompletionReview({
      transcript: [{ role: 'user', content: 'Verify the saved results.' }],
      catalog: createCatalog(), initialExecutionHistory: [priorExecution],
      initialTrackedSteps: trackedSteps,
      callModel: (messages, tools, options, checkpoint) => duty['callAgentModel'](
        messages, 'Follow the request.', tools, options, checkpoint
      ),
      executeFunction: vi.fn(), loadAgentSkill: async () => null
    })
    await vi.advanceTimersByTimeAsync(120_001)
    expect(attempts).toHaveLength(2)
    expect(attempts[0]?.signal?.aborted).toBe(firstResponse === 'timeout')
    expect(attempts[1]?.signal?.aborted).toBe(false)
    // A retry gets its own inference wait instead of the original deadline's remainder.
    expect(statuses().at(-1)?.deadlineAt).toBeGreaterThan(
      statuses()[0]!.startedAt + AGENT_MODEL_RESPONSE_TIMEOUT_MS
    )
    await vi.advanceTimersByTimeAsync(AGENT_MODEL_RESPONSE_MAX_DURATION_MS + 1_000)
    const result = await pending
    expect(attempts.at(-1)?.signal?.aborted).toBe(true)
    expect(result.intent).toBe('error')
    expect(result.answer).toContain('exceeded its time limit')
    expect(result.answer).toContain('Publish verified results')
    expect(result.answer).not.toContain('May I continue')
    expect(result.executionHistory).toEqual([priorExecution])
    expect(result.trackedSteps).toEqual(trackedSteps)
    expect(statuses().at(-1)?.state).toBe(ModelResponseState.Completed)
    const inferenceCount = coreMocks.prompt.mock.calls.length
    await duty['prepareContinuation'](result.transcript, {
      originalInput: 'Verify the saved results.',
      trackedSteps,
      executionHistory: [priorExecution],
      loadedToolkitIds: [],
      activeSkillId: null
    })
    expect(coreMocks.prompt).toHaveBeenCalledTimes(inferenceCount)
    expect(duty['responseTraceCollector'].snapshot({}).inferences?.at(-1)?.failureKind).toBe(CompletionFailureKind.Timeout)
  })

  it.each(['review', 'finalization'])('retains task state without restarting exhausted %s recovery', async (phase) => {
    const trackedSteps = [{ label: 'Verify the deliverable', status: 'in_progress' as const }]
    const callModel = vi.fn(async (_messages, _tools, options) => {
      if (!options.isCompletionReview && !options.isFinalizationAttempt) {
        return { textContent: 'Proposed result.' }
      }
      throw new AgentModelResponseTimeoutError()
    })
    const result = await runAgentLoopWithCompletionReview({
      transcript: [{ role: 'user', content: 'Verify the deliverable.' }],
      catalog: createCatalog(), initialTrackedSteps: trackedSteps, callModel,
      ...(phase === 'finalization' ? { maxIterations: 0, finishingIterations: 0 } : {}),
      executeFunction: vi.fn(), loadAgentSkill: async () => null
    })
    expect(result.intent).not.toBe('answer')
    expect(result.answer).toContain('exceeded its time limit')
    expect(result.trackedSteps).toEqual(trackedSteps)
    expect(callModel).toHaveBeenCalledTimes(phase === 'review' ? 2 : 1)
  })
})

describe('plan state', () => {
  const collection = {
    scope: 'Requested documents from the authoritative list', enumeration: 'completed' as const,
    evidence: 'All pages inspected. Range A has two documents; range B is empty.', cursor: '',
    items: [
      { id: 'A', status: 'completed' as const, details: 'Verified /tmp/A.pdf against document A' },
      { id: 'B', status: 'pending' as const }
    ]
  }
  const plan = [{ label: 'Retrieve documents', status: 'in_progress' as const, collection }]

  it('preserves step order and completed outcomes across partial and reordered updates', () => {
    const previous = [
      {
        label: 'Find video files',
        status: 'completed' as const,
        details: 'The full inventory is saved.'
      },
      { label: 'Group extensions', status: 'in_progress' as const }
    ]
    const updated = parseAgentPlan(JSON.stringify({
      steps: [{ label: 'Group extensions', status: 'completed' }]
    }), previous)

    expect(updated).toEqual([
      previous[0],
      { label: 'Group extensions', status: 'completed' }
    ])
    expect(isAgentPlanComplete(updated!)).toBe(true)
    expect(previous[1]?.status).toBe('in_progress')

    const extended = parseAgentPlan(JSON.stringify({
      steps: [
        { label: 'Show examples', status: 'pending' },
        updated![1],
        { label: 'Find video files', status: 'completed' }
      ]
    }), updated!)

    expect(extended).toEqual([
      ...updated!,
      { label: 'Show examples', status: 'pending' }
    ])
    expect(isAgentPlanComplete(extended!)).toBe(false)
    expect(parseAgentPlan(JSON.stringify({
      steps: [updated![1], updated![1]]
    }), updated!)).toBeNull()
  })

  it('retains omitted collection ledgers when another step is added or completed', () => {
    const updated = parseAgentPlan(JSON.stringify({
      steps: [{ label: 'Summarize documents', status: 'completed' }]
    }), plan)

    expect(updated).toEqual([
      ...plan,
      { label: 'Summarize documents', status: 'completed' }
    ])
    expect(updated?.[0]?.collection).not.toBe(collection)
    expect(isAgentPlanComplete(updated!)).toBe(false)
  })

  it('merges item deltas and preserves coverage and verified outcomes across plan updates', () => {
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

  it('rejects premature completion and execution before enumeration', () => {
    for (const steps of [
      [{ ...plan[0], status: 'completed' }],
      [{ ...plan[0], collection: { ...collection, enumeration: 'in_progress', items: [
        { id: 'B', status: 'in_progress' }
      ] } }],
      [{ ...plan[0], collection: { ...collection, items: [
        { id: 'B', status: 'completed' }
      ] } }],
      [{ ...plan[0], collection: { ...collection, items: [collection.items[0], collection.items[0]] } }]
    ]) {
      expect(parseAgentPlan(JSON.stringify({ steps }), plan)).toBeNull()
    }
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
