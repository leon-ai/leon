import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env['LEON_NODE_ENV'] = 'testing'
process.env['LEON_LLM'] = 'openai/gpt-5.4'

/**
 * Hoisted mocks let the imported ReAct module capture the fake phase functions
 * and shared runtime singletons during module initialization.
 */
const phaseMocks = vi.hoisted(() => ({
  buildCatalog: vi.fn(() => ({
    text: 'mock catalog',
    mode: 'function' as const
  })),
  runPlanningPhase: vi.fn(),
  runRecoveryPlanningPhase: vi.fn(),
  runExecutionSelfObservationPhase: vi.fn(),
  runExecutionStep: vi.fn(),
  runFinalAnswerPhase: vi.fn()
}))

const coreMocks = vi.hoisted(() => ({
  persona: {
    getCompactDutySystemPrompt: vi.fn((prompt: string) => prompt)
  },
  toolkitRegistry: {
    isLoaded: true,
    load: vi.fn()
  },
  contextManager: {
    isLoaded: true,
    load: vi.fn(),
    getContextFileContent: vi.fn(() => null),
    getManifest: vi.fn(() => '')
  },
  selfModelManager: {
    getSnapshot: vi.fn(() => '')
  },
  conversationLogger: {
    loadAll: vi.fn(async () => [])
  },
  llmProvider: {
    consumeLastProviderErrorMessage: vi.fn(() => null),
    prompt: vi.fn(),
    promptText: vi.fn(),
    promptWithTools: vi.fn()
  },
  brain: {
    talk: vi.fn(async () => undefined),
    wernicke: vi.fn(() => ''),
    isMuted: true
  },
  socket: {
    emit: vi.fn()
  }
}))

const widgetMocks = vi.hoisted(() => ({
  emitPlanWidget: vi.fn(),
  widgetId: vi.fn(() => 'plan_test_widget')
}))

/**
 * The unit suite stays on the remote-provider path, so a lightweight session
 * stub is enough to satisfy the local-provider import surface.
 */
vi.mock('node-llama-cpp', () => ({
  LlamaChatSession: class MockLlamaChatSession {
    setChatHistory(): void {}
    dispose(): void {}
  }
}))

vi.mock('@/helpers/log-helper', () => ({
  LogHelper: {
    title: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/core', () => ({
  LLM_MANAGER: {
    model: {
      createContext: vi.fn()
    }
  },
  LLM_PROVIDER: coreMocks.llmProvider,
  PERSONA: coreMocks.persona,
  TOOLKIT_REGISTRY: coreMocks.toolkitRegistry,
  CONTEXT_MANAGER: coreMocks.contextManager,
  SELF_MODEL_MANAGER: coreMocks.selfModelManager,
  CONVERSATION_LOGGER: coreMocks.conversationLogger,
  BRAIN: coreMocks.brain,
  SOCKET_SERVER: {
    socket: coreMocks.socket,
    emitToChatClients: coreMocks.socket.emit,
    emitAnswerToChatClients: coreMocks.socket.emit,
    clearLiveWidgets: vi.fn()
  }
}))

vi.mock('@/core/llm-manager/llm-duties/react-llm-duty/phases', () => ({
  buildCatalog: phaseMocks.buildCatalog,
  runPlanningPhase: phaseMocks.runPlanningPhase,
  runRecoveryPlanningPhase: phaseMocks.runRecoveryPlanningPhase,
  runExecutionSelfObservationPhase: phaseMocks.runExecutionSelfObservationPhase,
  runExecutionStep: phaseMocks.runExecutionStep,
  runFinalAnswerPhase: phaseMocks.runFinalAnswerPhase
}))

vi.mock('@/core/llm-manager/llm-duties/react-llm-duty/plan-widget', () => ({
  emitPlanWidget: widgetMocks.emitPlanWidget,
  widgetId: widgetMocks.widgetId
}))

let ReActLLMDuty: typeof import('@/core/llm-manager/llm-duties/react-llm-duty').ReActLLMDuty

function createMessageLog(
  who: 'owner' | 'leon',
  message: string,
  sentAt: number
): {
  who: 'owner' | 'leon'
  message: string
  sentAt: number
  isAddedToHistory: true
} {
  return {
    who,
    message,
    sentAt,
    isAddedToHistory: true
  }
}

function createCompactionState(
  overrides: Partial<{
    summary: string | null
    summarySentAt: number | null
    tail: ReturnType<typeof createMessageLog>[]
    newMessagesSinceCompaction: number
  }> = {}
): {
  summary: string | null
  summarySentAt: number | null
  tail: ReturnType<typeof createMessageLog>[]
  newMessagesSinceCompaction: number
} {
  return {
    summary: '- Previous topic',
    summarySentAt: 1,
    tail: [],
    newMessagesSinceCompaction: 0,
    ...overrides
  }
}

function logUnitProgress(message: string, data?: Record<string, unknown>): void {
  const serializedData = data ? ` ${JSON.stringify(data)}` : ''
  console.info(`[agent:unit] ${message}${serializedData}`)
}

async function createDuty(input: string): Promise<InstanceType<typeof ReActLLMDuty>> {
  const duty = new ReActLLMDuty({ input })

  /**
   * The suite focuses on loop orchestration, so history loading and post-answer
   * compaction are stubbed out to keep each case deterministic.
   */
  vi.spyOn(duty as never, 'loadPreparedHistory' as never).mockResolvedValue({
    messageLogs: [],
    localChatHistory: undefined
  })
  vi.spyOn(
    duty as never,
    'maybeCompactHistoryAfterAnswer' as never
  ).mockResolvedValue(undefined)

  await duty.init({ force: true })
  return duty
}

beforeAll(async () => {
  ;({ ReActLLMDuty } = await import('@/core/llm-manager/llm-duties/react-llm-duty'))
})

beforeEach(() => {
  vi.clearAllMocks()
  phaseMocks.buildCatalog.mockReturnValue({
    text: 'mock catalog',
    mode: 'function'
  })
  phaseMocks.runRecoveryPlanningPhase.mockResolvedValue(null)
  phaseMocks.runExecutionSelfObservationPhase.mockResolvedValue(null)
  coreMocks.persona.getCompactDutySystemPrompt.mockImplementation(
    (prompt: string) => prompt
  )
  coreMocks.contextManager.getContextFileContent.mockReturnValue(null)
  coreMocks.contextManager.getManifest.mockReturnValue('')
  coreMocks.selfModelManager.getSnapshot.mockReturnValue('')
  coreMocks.llmProvider.consumeLastProviderErrorMessage.mockReturnValue(null)
})

describe('ReActLLMDuty agent loop', () => {
  it('finalizes directly when planning returns a handoff', async () => {
    logUnitProgress('planning handoff scenario', {
      input: 'Hi there, what do you reply if I tell you "ping"?',
      expectedIntent: 'answer'
    })
    phaseMocks.runPlanningPhase.mockResolvedValue({
      type: 'handoff',
      signal: {
        intent: 'answer',
        draft: 'Reply with pong.',
        source: 'planning'
      }
    })
    phaseMocks.runFinalAnswerPhase.mockResolvedValue('Pong.')

    const duty = await createDuty(
      'Hi there, what do you reply if I tell you "ping"?'
    )
    const result = await duty.execute()

    logUnitProgress('planning handoff result', {
      output: result?.output,
      finalIntent: result?.data.finalIntent
    })

    expect(phaseMocks.runPlanningPhase).toHaveBeenCalledOnce()
    expect(phaseMocks.runExecutionStep).not.toHaveBeenCalled()
    expect(phaseMocks.runFinalAnswerPhase).toHaveBeenCalledOnce()
    expect(result?.output).toBe('Pong.')
    expect(result?.data.finalIntent).toBe('answer')
    expect(result?.data.executionHistory).toEqual([])
  })

  it('executes a planned step and synthesizes the final answer', async () => {
    logUnitProgress('planned execution scenario', {
      input: 'What\'s the weather like today in Shenzhen?',
      stepFunction: 'weather.openmeteo.getCurrentConditions'
    })
    phaseMocks.runPlanningPhase.mockResolvedValue({
      type: 'plan',
      steps: [
        {
          function: 'weather.openmeteo.getCurrentConditions',
          label: 'Check weather'
        }
      ],
      summary: 'Checking the weather...'
    })
    phaseMocks.runExecutionStep.mockResolvedValue({
      type: 'executed',
      execution: {
        function: 'weather.openmeteo.getCurrentConditions',
        status: 'success',
        observation: 'Current weather is 24C and sunny.',
        stepLabel: 'Check weather',
        requestedToolInput: '{"location":"Shenzhen"}'
      }
    })
    phaseMocks.runExecutionSelfObservationPhase.mockResolvedValue(null)
    phaseMocks.runFinalAnswerPhase.mockResolvedValue('It is 24C and sunny in Shenzhen.')

    const duty = await createDuty('What\'s the weather like today in Shenzhen?')
    const result = await duty.execute()

    logUnitProgress('planned execution result', {
      output: result?.output,
      executionHistory: result?.data.executionHistory
    })

    expect(coreMocks.brain.talk).toHaveBeenCalledWith('Checking the weather...')
    expect(phaseMocks.runExecutionStep).toHaveBeenCalledOnce()
    expect(phaseMocks.runExecutionSelfObservationPhase).toHaveBeenCalledOnce()
    expect(result?.output).toBe('It is 24C and sunny in Shenzhen.')
    expect(result?.data.finalIntent).toBe('answer')
    expect(result?.data.executionHistory).toEqual([
      {
        function: 'weather.openmeteo.getCurrentConditions',
        status: 'success',
        observation: 'Current weather is 24C and sunny.',
        stepLabel: 'Check weather',
        requestedToolInput: '{"location":"Shenzhen"}'
      }
    ])
  })

  it('short-circuits to final synthesis when a tool returns a handoff signal', async () => {
    // This covers the path where a tool result already contains the semantic
    // handoff Leon should forward into the final-answer phase.
    logUnitProgress('tool handoff scenario', {
      input: 'There is a file waiting for you. Do what it asks you to do.',
      stepFunction: 'operating_system_control.bash.executeBashCommand'
    })
    phaseMocks.runPlanningPhase.mockResolvedValue({
      type: 'plan',
      steps: [
        {
          function: 'operating_system_control.bash.executeBashCommand',
          label: 'List project root'
        }
      ],
      summary: 'Listing the project root...'
    })
    phaseMocks.runExecutionStep.mockResolvedValue({
      type: 'executed',
      execution: {
        function: 'operating_system_control.bash.executeBashCommand',
        status: 'success',
        observation: 'package.json\nserver\nbridges',
        stepLabel: 'List project root',
        requestedToolInput: '{"command":"ls -1"}'
      },
      handoffSignal: {
        intent: 'answer',
        draft: 'Report the listed project root files.',
        source: 'tool'
      }
    })
    phaseMocks.runFinalAnswerPhase.mockResolvedValue(
      'The project root contains package.json, server, and bridges.'
    )

    const duty = await createDuty(
      'There is a file waiting for you. Do what it asks you to do.'
    )
    const result = await duty.execute()

    logUnitProgress('tool handoff result', {
      output: result?.output,
      finalIntent: result?.data.finalIntent
    })

    expect(coreMocks.brain.talk).toHaveBeenCalledWith(
      'Listing the project root...'
    )
    expect(phaseMocks.runExecutionStep).toHaveBeenCalledOnce()
    expect(phaseMocks.runExecutionSelfObservationPhase).not.toHaveBeenCalled()
    expect(result?.output).toBe(
      'The project root contains package.json, server, and bridges.'
    )
    expect(result?.data.executionHistory).toEqual([
      {
        function: 'operating_system_control.bash.executeBashCommand',
        status: 'success',
        observation: 'package.json\nserver\nbridges',
        stepLabel: 'List project root',
        requestedToolInput: '{"command":"ls -1"}'
      }
    ])
  })

  describe('history compaction', () => {
    it('tracks only newly appended history entries when the saved tail still matches', () => {
      const duty = new ReActLLMDuty({ input: 'Hi there' })
      const currentState = createCompactionState({
        tail: [
          createMessageLog('owner', 'Earlier owner turn', 10),
          createMessageLog('leon', 'Earlier Leon turn', 11)
        ]
      })
      const synchronized = (
        duty as never
      ).synchronizeHistoryCompactionState(
        [
          ...currentState.tail,
          createMessageLog('owner', 'New owner turn', 12),
          createMessageLog('leon', 'New Leon turn', 13)
        ],
        currentState
      )

      expect(synchronized.shouldPersist).toBe(true)
      expect(synchronized.state.summary).toBe('- Previous topic')
      expect(synchronized.state.tail).toHaveLength(4)
      expect(synchronized.state.newMessagesSinceCompaction).toBe(2)
    })

    it('rebuilds the tail from the saved compaction boundary when the stored tail no longer matches', () => {
      const duty = new ReActLLMDuty({ input: 'Hi there' })
      const conversationLogs = [
        createMessageLog('owner', 'Before summary', 10),
        createMessageLog('leon', 'Last compacted reply', 20),
        createMessageLog('owner', 'Fresh owner turn', 30),
        createMessageLog('leon', 'Fresh Leon turn', 31)
      ]
      const currentState = createCompactionState({
        summarySentAt: 20,
        tail: [createMessageLog('owner', 'Stale tail entry', 21)]
      })
      const synchronized = (
        duty as never
      ).synchronizeHistoryCompactionState(conversationLogs, currentState)

      expect(synchronized.shouldPersist).toBe(true)
      expect(synchronized.state.summary).toBe('- Previous topic')
      expect(synchronized.state.summarySentAt).toBe(20)
      expect(synchronized.state.tail).toEqual(conversationLogs.slice(2))
      expect(synchronized.state.newMessagesSinceCompaction).toBe(2)
    })

    it('rebuilds the tail from the saved compaction boundary when the stored tail is empty', () => {
      const duty = new ReActLLMDuty({ input: 'Hi there' })
      const conversationLogs = [
        createMessageLog('owner', 'Before summary', 10),
        createMessageLog('leon', 'Last compacted reply', 20),
        createMessageLog('owner', 'Fresh owner turn', 30)
      ]
      const currentState = createCompactionState({
        summarySentAt: 20,
        tail: []
      })
      const synchronized = (
        duty as never
      ).synchronizeHistoryCompactionState(conversationLogs, currentState)

      expect(synchronized.shouldPersist).toBe(true)
      expect(synchronized.state.summary).toBe('- Previous topic')
      expect(synchronized.state.tail).toEqual([conversationLogs[2]])
      expect(synchronized.state.newMessagesSinceCompaction).toBe(1)
    })

    it('keeps the compacted summary in prompt history while clipping the raw tail window', () => {
      const duty = new ReActLLMDuty({ input: 'Hi there' })
      const state = createCompactionState({
        summarySentAt: 50,
        tail: Array.from({ length: 60 }, (_, index) =>
          createMessageLog(
            index % 2 === 0 ? 'owner' : 'leon',
            `Message ${index + 1}`,
            100 + index
          )
        ),
        newMessagesSinceCompaction: 24
      })
      const history = (duty as never).buildHistoryForCurrentTurn([], state, {
        historyLimit: 48,
        compactionBatchSize: 36
      })

      expect(history).toHaveLength(48)
      expect(history[0]?.message).toBe(
        'Earlier conversation summary:\n- Previous topic'
      )
      expect(history[1]?.message).toBe('Message 14')
      expect(history[47]?.message).toBe('Message 60')
    })

    it('does not compact again when the fresh-entry counter is still below the threshold', async () => {
      const duty = new ReActLLMDuty({ input: 'Set a timer for 3 seconds' })
      const state = createCompactionState({
        summary: '- Timer discussion already compacted',
        summarySentAt: 100,
        tail: Array.from({ length: 38 }, (_, index) =>
          createMessageLog(
            index % 2 === 0 ? 'owner' : 'leon',
            `Tail message ${index + 1}`,
            200 + index
          )
        ),
        newMessagesSinceCompaction: 2
      })
      const loadStateSpy = vi
        .spyOn(duty as never, 'loadHistoryCompactionProviderState' as never)
        .mockReturnValue(state)
      const rollSpy = vi
        .spyOn(duty as never, 'rollHistoryCompactionState' as never)
        .mockResolvedValue(state)

      coreMocks.conversationLogger.loadAll.mockResolvedValue(state.tail)

      await (duty as never).maybeCompactHistoryAfterAnswer('plan_test_widget', [])

      expect(loadStateSpy).toHaveBeenCalledOnce()
      expect(rollSpy).not.toHaveBeenCalled()
      expect(widgetMocks.emitPlanWidget).not.toHaveBeenCalled()
    })
  })
})
