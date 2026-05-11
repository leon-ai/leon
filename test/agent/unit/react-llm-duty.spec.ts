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
    load: vi.fn(),
    getFlattenedTools: vi.fn(() => [
      {
        toolkitId: 'operating_system_control',
        toolkitName: 'Operating System Control',
        toolkitDescription: 'Control the operating system.',
        toolkitIconName: 'terminal',
        toolId: 'bash',
        toolName: 'Bash',
        toolDescription: 'Execute shell commands.',
        toolIconName: 'terminal'
      }
    ]),
    getToolFunctions: vi.fn((toolkitId: string, toolId: string) => {
      if (toolkitId !== 'operating_system_control' || toolId !== 'bash') {
        return null
      }

      return {
        executeBashCommand: {
          description: 'Execute a bash command and return the result.',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' }
            },
            required: ['command']
          }
        }
      }
    }),
    resolveToolById: vi.fn((toolId: string, toolkitId?: string) => {
      if (
        toolId !== 'bash' ||
        (toolkitId && toolkitId !== 'operating_system_control')
      ) {
        return null
      }

      return {
        toolkitId: 'operating_system_control',
        toolkitName: 'Operating System Control',
        toolkitIconName: 'terminal',
        toolId: 'bash',
        toolName: 'Bash',
        toolDescription: 'Execute shell commands.',
        toolIconName: 'terminal'
      }
    }),
    getToolkitContextFiles: vi.fn(() => [])
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
  TOOL_EXECUTOR: {
    execute: vi.fn()
  },
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
let runFinalAnswerPhase: typeof import('@/core/llm-manager/llm-duties/react-llm-duty/final-answer').runFinalAnswerPhase
let runPlanningPhaseDirect: typeof import('@/core/llm-manager/llm-duties/react-llm-duty/planning').runPlanningPhase
let runExecutionStepDirect: typeof import('@/core/llm-manager/llm-duties/react-llm-duty/execution').runExecutionStep
let runExecutionSelfObservationPhaseDirect: typeof import('@/core/llm-manager/llm-duties/react-llm-duty/execution').runExecutionSelfObservationPhase

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
  ;({ runFinalAnswerPhase } = await import(
    '@/core/llm-manager/llm-duties/react-llm-duty/final-answer'
  ))
  ;({ runPlanningPhase: runPlanningPhaseDirect } = await import(
    '@/core/llm-manager/llm-duties/react-llm-duty/planning'
  ))
  ;({
    runExecutionStep: runExecutionStepDirect,
    runExecutionSelfObservationPhase: runExecutionSelfObservationPhaseDirect
  } = await import('@/core/llm-manager/llm-duties/react-llm-duty/execution'))
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
  it('passes conversation history into execution tool argument selection', async () => {
    const history = [
      createMessageLog(
        'leon',
        'Install a local Obsidian smooth cursor plugin named leon-smooth-cursor across the detected vaults.',
        1
      ),
      createMessageLog('owner', 'Then do it', 2)
    ]
    const callLLMWithTools = vi.fn(async () => ({
      textContent: JSON.stringify({
        type: 'handoff',
        intent: 'answer',
        draft: 'Execution context retained.'
      })
    }))
    const caller = {
      callLLM: vi.fn(),
      callLLMText: vi.fn(),
      callLLMWithTools,
      supportsNativeTools: true,
      input: 'Then do it',
      history,
      agentSkillCatalog: '',
      setAgentSkillContext: vi.fn(),
      getAgentSkillContext: vi.fn(),
      getContextFileContent: vi.fn(() => null),
      getContextManifest: vi.fn(() => ''),
      getSelfModelSnapshot: vi.fn(() => ''),
      consumeProviderErrorMessage: vi.fn(() => null)
    }

    const result = await runExecutionStepDirect(
      caller,
      {
        function: 'functions.executeBashCommand',
        label: 'Install smooth cursor plugin'
      },
      [],
      {
        text: 'mock catalog',
        mode: 'function'
      }
    )

    expect(result).toEqual({
      type: 'handoff',
      signal: {
        intent: 'answer',
        draft: 'Execution context retained.',
        source: 'execution'
      }
    })
    expect(callLLMWithTools).toHaveBeenCalledOnce()
    expect(callLLMWithTools.mock.calls[0]?.[4]).toBe(history)
  })

  it('passes conversation history into execution self-observation', async () => {
    const history = [
      createMessageLog('leon', 'The next step is to write plugin files.', 1),
      createMessageLog('owner', 'Then do it', 2)
    ]
    const callLLM = vi.fn(async () => ({
      output: {
        type: 'handoff',
        intent: 'answer',
        draft: 'No more steps needed.',
        functions: null,
        steps: null,
        reason: null
      }
    }))
    const caller = {
      callLLM,
      callLLMText: vi.fn(),
      callLLMWithTools: vi.fn(),
      supportsNativeTools: true,
      input: 'Then do it',
      history,
      agentSkillCatalog: '',
      setAgentSkillContext: vi.fn(),
      getAgentSkillContext: vi.fn(),
      getContextFileContent: vi.fn(() => null),
      getContextManifest: vi.fn(() => ''),
      getSelfModelSnapshot: vi.fn(() => ''),
      consumeProviderErrorMessage: vi.fn(() => null)
    }

    const result = await runExecutionSelfObservationPhaseDirect(caller, [])

    expect(result).toEqual({
      type: 'handoff',
      signal: {
        intent: 'answer',
        draft: 'No more steps needed.',
        source: 'self_observation'
      }
    })
    expect(callLLM).toHaveBeenCalledOnce()
    expect(callLLM.mock.calls[0]?.[3]).toBe(history)
  })

  it('skips Agent Skill selection when no name or metadata match is present', async () => {
    const callLLMWithTools = vi.fn(async () => ({
      toolCall: {
        functionName: 'create_plan',
        arguments: JSON.stringify({
          type: 'final',
          answer: 'Acknowledge the thanks.',
          intent: 'answer'
        })
      }
    }))
    const caller = {
      callLLM: vi.fn(),
      callLLMText: vi.fn(),
      callLLMWithTools,
      supportsNativeTools: true,
      input: 'Awesome, thanks',
      history: [],
      agentSkillCatalog:
        '1. tiny-web-crawler: Crawl from starting web pages, fetch readable content, search within pages, and follow relevant links.',
      setAgentSkillContext: vi.fn(),
      getAgentSkillContext: vi.fn(),
      getContextFileContent: vi.fn(() => null),
      getContextManifest: vi.fn(() => ''),
      getSelfModelSnapshot: vi.fn(() => ''),
      consumeProviderErrorMessage: vi.fn(() => null)
    }

    const result = await runPlanningPhaseDirect(
      caller,
      {
        text: 'mock catalog',
        mode: 'function'
      },
      []
    )

    expect(callLLMWithTools).toHaveBeenCalledOnce()
    expect(callLLMWithTools.mock.calls[0]?.[2]?.[0]?.function.name).toBe(
      'create_plan'
    )
    expect(result).toEqual({
      type: 'handoff',
      signal: {
        intent: 'answer',
        draft: 'Acknowledge the thanks.',
        source: 'planning'
      }
    })
  })

  it('attempts Agent Skill selection on a clear metadata match', async () => {
    const agentSkillContext = {
      id: 'tiny-web-crawler',
      name: 'tiny-web-crawler',
      description: 'Crawl from starting web pages.',
      rootPath: '/tmp/tiny-web-crawler',
      skillPath: '/tmp/tiny-web-crawler/SKILL.md',
      instructions: '# Tiny Web Crawler'
    }
    const callLLMWithTools = vi
      .fn()
      .mockResolvedValueOnce({
        toolCall: {
          functionName: 'select_agent_skill',
          arguments: JSON.stringify({
            skill_id: 'tiny-web-crawler',
            reason: 'The request asks to crawl and fetch web page content.'
          })
        }
      })
      .mockResolvedValueOnce({
        toolCall: {
          functionName: 'create_plan',
          arguments: JSON.stringify({
            type: 'plan',
            steps: [
              {
                function: 'operating_system_control.bash.executeBashCommand',
                label: 'Fetch target page'
              }
            ],
            summary: 'Fetching the target page...',
            answer: null,
            intent: null
          })
        }
      })
    const caller = {
      callLLM: vi.fn(),
      callLLMText: vi.fn(),
      callLLMWithTools,
      supportsNativeTools: true,
      input:
        'Please crawl from https://example.com, fetch readable content, and follow relevant links to find pricing.',
      history: [],
      agentSkillCatalog:
        '1. tiny-web-crawler: Crawl from starting web pages, fetch readable content, search within pages, and follow relevant links.',
      setAgentSkillContext: vi.fn(),
      getAgentSkillContext: vi.fn(async () => agentSkillContext),
      getContextFileContent: vi.fn(() => null),
      getContextManifest: vi.fn(() => ''),
      getSelfModelSnapshot: vi.fn(() => ''),
      consumeProviderErrorMessage: vi.fn(() => null)
    }

    const result = await runPlanningPhaseDirect(
      caller,
      {
        text: 'mock catalog',
        mode: 'function'
      },
      []
    )

    expect(callLLMWithTools).toHaveBeenCalledTimes(2)
    expect(callLLMWithTools.mock.calls[0]?.[2]?.[0]?.function.name).toBe(
      'select_agent_skill'
    )
    expect(callLLMWithTools.mock.calls[1]?.[2]?.[0]?.function.name).toBe(
      'create_plan'
    )
    expect(caller.setAgentSkillContext).toHaveBeenCalledWith(agentSkillContext)
    expect(result).toEqual({
      type: 'plan',
      steps: [
        {
          function: 'operating_system_control.bash.executeBashCommand',
          label: 'Fetch target page'
        }
      ],
      summary: 'Fetching the target page...'
    })
  })

  it('uses the handoff draft when final answer synthesis fails', async () => {
    const callLLMText = vi.fn(async () => null)
    const callLLMWithTools = vi.fn()
    const caller = {
      callLLM: vi.fn(),
      callLLMText,
      callLLMWithTools,
      supportsNativeTools: true,
      input: 'Summarize the completed research.',
      history: [],
      agentSkillCatalog: '',
      setAgentSkillContext: vi.fn(),
      getAgentSkillContext: vi.fn(),
      getContextFileContent: vi.fn(() => null),
      getContextManifest: vi.fn(() => ''),
      getSelfModelSnapshot: vi.fn(() => ''),
      consumeProviderErrorMessage: vi.fn(() => null)
    }

    const result = await runFinalAnswerPhase(
      caller,
      [],
      {
        intent: 'answer',
        draft: 'Research complete. The useful summary is already here.',
        source: 'execution'
      }
    )

    expect(result).toBe(
      'Research complete. The useful summary is already here.'
    )
    expect(callLLMText).toHaveBeenCalledOnce()
    expect(callLLMWithTools).not.toHaveBeenCalled()
  })

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

  it('keeps a selected Agent Skill active during execution', async () => {
    const agentSkillContext = {
      id: 'tiny-web-crawler',
      name: 'tiny-web-crawler',
      description: 'Fetch and crawl web pages.',
      rootPath: '/tmp/tiny-web-crawler',
      skillPath: '/tmp/tiny-web-crawler/SKILL.md',
      instructions: '# Tiny Web Crawler'
    }

    phaseMocks.runPlanningPhase.mockImplementation(async (caller) => {
      caller.setAgentSkillContext(agentSkillContext)

      return {
        type: 'plan',
        steps: [
          {
            function: 'operating_system_control.bash.executeBashCommand',
            label: 'Fetch target page'
          }
        ],
        summary: 'Fetching the target page...'
      }
    })
    phaseMocks.runExecutionStep.mockImplementation(async (caller) => {
      expect(caller.agentSkillContext).toEqual(agentSkillContext)

      return {
        type: 'executed',
        execution: {
          function: 'operating_system_control.bash.executeBashCommand',
          status: 'success',
          observation: 'Fetched with skill script.',
          stepLabel: 'Fetch target page'
        }
      }
    })
    phaseMocks.runFinalAnswerPhase.mockResolvedValue('Fetched with skill script.')

    const duty = await createDuty(
      'Use the tiny-web-crawler skill to inspect a page.'
    )
    const result = await duty.execute()

    expect(phaseMocks.runExecutionStep).toHaveBeenCalledOnce()
    expect(result?.output).toBe('Fetched with skill script.')
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

  it('pauses for clarification during execution and resumes pending steps', async () => {
    interface SavedContinuationState {
      originalInput: string
      clarificationQuestion: string
      pendingSteps: Array<{ function: string, label: string }>
    }

    let savedContinuation: SavedContinuationState | null = null
    const fileCreationStep = {
      function: 'operating_system_control.bash.executeBashCommand',
      label: 'Create file'
    }

    phaseMocks.runPlanningPhase.mockResolvedValue({
      type: 'plan',
      steps: [fileCreationStep],
      summary: 'Preparing the file creation...'
    })
    phaseMocks.runExecutionStep
      .mockResolvedValueOnce({
        type: 'handoff',
        signal: {
          intent: 'clarification',
          draft: 'What filename should I use?',
          source: 'execution'
        }
      })
      .mockImplementationOnce(async (caller, currentStep) => {
        expect(caller.input).toContain(
          'Previous clarification request: "What filename should I use?"'
        )
        expect(caller.input).toContain('Clarification reply: "test.txt"')
        expect(currentStep).toEqual(fileCreationStep)

        return {
          type: 'executed',
          execution: {
            function: 'operating_system_control.bash.executeBashCommand',
            status: 'success',
            observation: 'Created /home/louis/Downloads/test.txt',
            stepLabel: 'Create file',
            requestedToolInput: '{"command":"touch /home/louis/Downloads/test.txt"}'
          }
        }
      })
    phaseMocks.runFinalAnswerPhase
      .mockResolvedValueOnce('What filename should I use?')
      .mockResolvedValueOnce(
        'Done. I created [FILE_PATH]/home/louis/Downloads/test.txt[/FILE_PATH].'
      )

    const initialDuty = await createDuty(
      'Create a text file in Downloads, but ask me for the filename first.'
    )
    vi.spyOn(
      initialDuty as never,
      'saveExecutionContinuation' as never
    ).mockImplementation((state: SavedContinuationState) => {
      savedContinuation = state
    })

    const clarificationResult = await initialDuty.execute()

    expect(clarificationResult?.output).toBe('What filename should I use?')
    expect(clarificationResult?.data.finalIntent).toBe('clarification')
    expect(savedContinuation?.pendingSteps).toEqual([fileCreationStep])

    const resumeDuty = await createDuty('test.txt')
    vi.spyOn(
      resumeDuty as never,
      'loadExecutionContinuation' as never
    ).mockReturnValue(savedContinuation)
    vi.spyOn(
      resumeDuty as never,
      'clearExecutionContinuation' as never
    ).mockImplementation(() => undefined)

    const resumedResult = await resumeDuty.execute()

    expect(phaseMocks.runPlanningPhase).toHaveBeenCalledOnce()
    expect(phaseMocks.runExecutionStep).toHaveBeenCalledTimes(2)
    expect(resumedResult?.output).toBe(
      'Done. I created [FILE_PATH]/home/louis/Downloads/test.txt[/FILE_PATH].'
    )
    expect(resumedResult?.data.finalIntent).toBe('answer')
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
