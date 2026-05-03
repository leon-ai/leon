import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env['LEON_NODE_ENV'] = 'testing'
process.env['LEON_LLM'] = 'openai/gpt-5.4'

const defaultProcessResult = {
  contextName: '',
  skillName: '',
  actionName: '',
  skillConfigPath: '',
  skillConfig: {
    name: '',
    bridge: 'python',
    version: '',
    workflow: []
  },
  localeSkillConfig: {
    variables: {},
    widgetContents: {}
  },
  actionConfig: null,
  new: {
    utterance: '',
    actionArguments: {},
    entities: [],
    sentiment: {}
  },
  context: {
    utterances: [],
    actionArguments: [],
    entities: [],
    sentiments: [],
    data: {}
  }
}

const testState = vi.hoisted(() => ({
  currentNlu: null as unknown,
  skillConfigs: {} as Record<string, Record<string, unknown>>,
  localeConfigs: {} as Record<string, Record<string, unknown>>
}))

const coreMocks = vi.hoisted(() => ({
  brain: {
    runSkillAction: vi.fn(),
    talk: vi.fn(async () => undefined),
    suggest: vi.fn(),
    isMuted: false,
    lang: 'en',
    wernicke: vi.fn(() => '')
  },
  conversationLogger: {
    push: vi.fn(async () => undefined),
    load: vi.fn(async () => []),
    loadAll: vi.fn(async () => [])
  },
  socket: {
    emit: vi.fn()
  },
  memoryManager: {
    observeTurn: vi.fn(async () => undefined),
    savePersistentMemoryCandidatesFromTurn: vi.fn(async () => undefined)
  },
  selfModelManager: {
    observeTurn: vi.fn(async () => undefined)
  },
  llmProvider: {
    consumeLastProviderErrorMessage: vi.fn(() => null)
  },
  persona: {
    refreshContextInfo: vi.fn()
  },
  toolCallLogger: {
    runOwnerQuery: vi.fn(async (_utterance: string, runner: () => Promise<unknown>) => {
      return runner()
    })
  },
  pulseManager: {
    observeOwnerUtterance: vi.fn(async () => undefined)
  }
}))

const dutyMocks = vi.hoisted(() => ({
  skillRouterExecute: vi.fn(),
  actionCallingExecute: vi.fn(),
  slotFillingExecute: vi.fn()
}))

const skillHelperMocks = vi.hoisted(() => ({
  getNewSkillConfig: vi.fn(async (skillName: string) => {
    return testState.skillConfigs[skillName] || null
  }),
  getNewSkillConfigPath: vi.fn((skillName: string) => {
    return `/tmp/${skillName}/skill.json`
  }),
  getSkillLocaleConfig: vi.fn(async (_lang: string, skillName: string) => {
    return (
      testState.localeConfigs[skillName] || {
        variables: {},
        widget_contents: {},
        actions: {}
      }
    )
  })
}))

function cloneDefaultProcessResult(): typeof defaultProcessResult {
  return JSON.parse(JSON.stringify(defaultProcessResult)) as typeof defaultProcessResult
}

async function applyProcessResultUpdate(
  newResult: Record<string, unknown>
): Promise<void> {
  const currentNlu = testState.currentNlu as {
    nluProcessResult: typeof defaultProcessResult
  } | null

  if (!currentNlu) {
    return
  }

  const current = currentNlu.nluProcessResult

  if (newResult['new'] && typeof newResult['new'] === 'object') {
    const newData = newResult['new'] as Record<string, unknown>

    if (typeof newData['utterance'] === 'string' && newData['utterance'] !== '') {
      currentNlu.nluProcessResult = {
        ...current,
        new: {
          utterance: newData['utterance'],
          actionArguments: {},
          entities: [],
          sentiment: {}
        },
        context: {
          ...current.context,
          utterances: [...current.context.utterances, newData['utterance']],
          entities: [],
          sentiments: []
        }
      }
      return
    }

    if (newData['actionArguments']) {
      currentNlu.nluProcessResult = {
        ...current,
        new: {
          ...current.new,
          actionArguments: newData['actionArguments'] as Record<string, unknown>
        },
        context: {
          ...current.context,
          actionArguments: [
            ...current.context.actionArguments,
            { ...(newData['actionArguments'] as Record<string, unknown>) }
          ]
        }
      }
      return
    }
  }

  if (typeof newResult['skillName'] === 'string' && newResult['skillName'] !== '') {
    const skillName = newResult['skillName'] as string
    const skillConfig = testState.skillConfigs[skillName] as Record<string, unknown>
    const localeConfig =
      (testState.localeConfigs[skillName] as Record<string, unknown>) || {}

    currentNlu.nluProcessResult = {
      ...cloneDefaultProcessResult(),
      contextName: skillName.replace(/_skill$/, ''),
      skillName,
      skillConfigPath: `/tmp/${skillName}/skill.json`,
      skillConfig: {
        name: String(skillConfig['name'] || ''),
        bridge: String(skillConfig['bridge'] || 'nodejs'),
        version: String(skillConfig['version'] || '1.0.0'),
        workflow: Array.isArray(skillConfig['workflow']) ? skillConfig['workflow'] : []
      },
      localeSkillConfig: {
        variables:
          (localeConfig['variables'] as Record<string, unknown>) || {},
        widgetContents:
          (localeConfig['widget_contents'] as Record<string, unknown>) || {}
      },
      new: current.new,
      context: {
        utterances: [current.new.utterance],
        actionArguments: [],
        entities: [],
        sentiments: [],
        data: current.context.data
      }
    }
    return
  }

  if (typeof newResult['actionName'] === 'string' && newResult['actionName'] !== '') {
    const actionName = newResult['actionName'] as string
    const skillConfig = testState.skillConfigs[current.skillName] as Record<
      string,
      unknown
    >
    const actions = (skillConfig['actions'] as Record<string, unknown>) || {}
    const localeConfig =
      (testState.localeConfigs[current.skillName] as Record<string, unknown>) || {}
    const localeActions =
      (localeConfig['actions'] as Record<string, Record<string, unknown>>) || {}

    currentNlu.nluProcessResult = {
      ...current,
      actionName,
      actionConfig: {
        ...(actions[actionName] as Record<string, unknown>),
        ...(localeActions[actionName] || {})
      }
    }
    return
  }

  currentNlu.nluProcessResult = {
    ...current,
    ...(newResult as Partial<typeof defaultProcessResult>)
  }
}

vi.mock('@/helpers/log-helper', () => ({
  LogHelper: {
    title: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/constants')>()

  return {
    ...actual,
    LEON_ROUTING_MODE: 'controlled'
  }
})

vi.mock('@/core', () => ({
  BRAIN: coreMocks.brain,
  CONVERSATION_LOGGER: coreMocks.conversationLogger,
  SOCKET_SERVER: {
    socket: coreMocks.socket,
    emitToChatClients: coreMocks.socket.emit,
    emitAnswerToChatClients: coreMocks.socket.emit,
    clearLiveWidgets: vi.fn()
  },
  MEMORY_MANAGER: coreMocks.memoryManager,
  PERSONA: coreMocks.persona,
  LLM_PROVIDER: coreMocks.llmProvider,
  TOOL_CALL_LOGGER: coreMocks.toolCallLogger,
  SELF_MODEL_MANAGER: coreMocks.selfModelManager,
  PULSE_MANAGER: coreMocks.pulseManager
}))

vi.mock('@/helpers/skill-domain-helper', () => ({
  SkillDomainHelper: skillHelperMocks
}))

vi.mock('@/core/nlp/nlu/workflow-progress-widget', () => ({
  WorkflowProgressWidget: class {
    public startTurn(): void {}
    public showChoosingSkill(): void {}
    public showPickingAction(): void {}
    public showResolvingParameters(): void {}
    public startAction(): void {}
    public completeRoutingOnly(): void {}
    public completeSelectionNotFound(): void {}
    public completeAll(): void {}
    public reset(): void {}
  }
}))

vi.mock('@/core/nlp/nlu/nlu-process-result-updater', () => ({
  DEFAULT_NLU_PROCESS_RESULT: cloneDefaultProcessResult(),
  NLUProcessResultUpdater: {
    update: vi.fn(applyProcessResultUpdate)
  }
}))

vi.mock('@/core/llm-manager/llm-duties/skill-router-llm-duty', () => ({
  SkillRouterLLMDuty: class {
    public async init(): Promise<void> {}
    public async execute(): Promise<unknown> {
      return dutyMocks.skillRouterExecute()
    }
  }
}))

vi.mock('@/core/llm-manager/llm-duties/action-calling-llm-duty', () => ({
  ActionCallingLLMDuty: class {
    public async init(): Promise<void> {}
    public async execute(): Promise<unknown> {
      return dutyMocks.actionCallingExecute()
    }
  }
}))

vi.mock('@/core/llm-manager/llm-duties/slot-filling-llm-duty', () => ({
  SlotFillingLLMDuty: class {
    public async init(): Promise<void> {}
    public async execute(): Promise<unknown> {
      return dutyMocks.slotFillingExecute()
    }
  }
}))

vi.mock('@/core/llm-manager/llm-duties/react-llm-duty', () => ({
  ReActLLMDuty: class {
    public async init(): Promise<void> {}
    public async execute(): Promise<unknown> {
      return {
        output: 'fallback'
      }
    }
  }
}))

let NLUClass: typeof import('@/core/nlp/nlu/nlu').default

beforeAll(async () => {
  ;({ default: NLUClass } = await import('@/core/nlp/nlu/nlu'))
})

beforeEach(() => {
  vi.clearAllMocks()
  testState.skillConfigs = {}
  testState.localeConfigs = {}

  const nlu = new NLUClass()
  nlu.nluProcessResult = cloneDefaultProcessResult()
  testState.currentNlu = nlu
})

describe('Controlled NLU', () => {
  it('executes workflow actions sequentially', async () => {
    const nlu = testState.currentNlu as InstanceType<typeof NLUClass>

    testState.skillConfigs['demo_flow_skill'] = {
      name: 'Demo Workflow',
      bridge: 'nodejs',
      version: '1.0.0',
      workflow: ['step_one', 'step_two'],
      actions: {
        step_one: {
          type: 'logic',
          description: 'First step.'
        },
        step_two: {
          type: 'logic',
          description: 'Second step.'
        }
      }
    }
    testState.localeConfigs['demo_flow_skill'] = {
      variables: {},
      widget_contents: {},
      actions: {
        step_one: {},
        step_two: {}
      }
    }

    nlu.nluProcessResult = {
      ...cloneDefaultProcessResult(),
      contextName: 'demo_flow',
      skillName: 'demo_flow_skill',
      actionName: 'step_one',
      skillConfigPath: '/tmp/demo_flow_skill/skill.json',
      skillConfig: {
        name: 'Demo Workflow',
        bridge: 'nodejs',
        version: '1.0.0',
        workflow: ['step_one', 'step_two']
      },
      localeSkillConfig: {
        variables: {},
        widgetContents: {}
      },
      actionConfig: {
        type: 'logic',
        description: 'First step.'
      },
      new: {
        utterance: 'Run the demo workflow',
        actionArguments: {},
        entities: [],
        sentiment: {}
      },
      context: {
        utterances: ['Run the demo workflow'],
        actionArguments: [],
        entities: [],
        sentiments: [],
        data: {}
      }
    }

    coreMocks.brain.runSkillAction
      .mockResolvedValueOnce({ core: {} })
      .mockResolvedValueOnce({ core: {} })

    await (nlu as unknown as { handleActionSuccess: (output: Record<string, unknown>) => Promise<void> }).handleActionSuccess({
      status: 'success',
      name: 'step_one',
      arguments: {}
    })

    expect(coreMocks.brain.runSkillAction).toHaveBeenCalledTimes(2)
    expect(coreMocks.brain.runSkillAction.mock.calls[0]?.[0].actionName).toBe(
      'step_one'
    )
    expect(coreMocks.brain.runSkillAction.mock.calls[1]?.[0].actionName).toBe(
      'step_two'
    )
  })

  it('fills a missing parameter before executing the pending workflow action', async () => {
    const nlu = testState.currentNlu as InstanceType<typeof NLUClass>

    testState.skillConfigs['timer_skill'] = {
      name: 'Timer',
      bridge: 'nodejs',
      version: '1.0.0',
      workflow: [],
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
      }
    }
    testState.localeConfigs['timer_skill'] = {
      variables: {},
      widget_contents: {},
      actions: {
        set_timer: {}
      }
    }

    nlu.nluProcessResult = {
      ...cloneDefaultProcessResult(),
      contextName: 'timer',
      skillName: 'timer_skill',
      actionName: 'set_timer',
      skillConfigPath: '/tmp/timer_skill/skill.json',
      skillConfig: {
        name: 'Timer',
        bridge: 'nodejs',
        version: '1.0.0',
        workflow: []
      },
      localeSkillConfig: {
        variables: {},
        widgetContents: {}
      },
      actionConfig: {
        type: 'logic',
        description: 'Set a timer.',
        parameters: {
          duration: {
            type: 'string',
            description: 'Timer duration.'
          }
        }
      },
      new: {
        utterance: '3 secs',
        actionArguments: {},
        entities: [],
        sentiment: {}
      },
      context: {
        utterances: ['Set a timer', '3 secs'],
        actionArguments: [],
        entities: [],
        sentiments: [],
        data: {}
      }
    }

    nlu.conversation.setActiveState({
      startingUtterance: 'Set a timer',
      pendingAction: 'timer_skill:set_timer',
      missingParameters: ['duration'],
      collectedParameters: {}
    })

    dutyMocks.slotFillingExecute.mockResolvedValue({
      output: {
        status: 'success',
        filled_slots: {
          duration: '3 secs'
        }
      }
    })
    coreMocks.brain.runSkillAction.mockResolvedValue({
      core: {}
    })

    const shouldContinue = await (nlu as unknown as {
      preProcessRoute: () => Promise<boolean>
    }).preProcessRoute()

    expect(shouldContinue).toBe(false)
    expect(coreMocks.brain.runSkillAction).toHaveBeenCalledTimes(1)
    expect(
      coreMocks.brain.runSkillAction.mock.calls[0]?.[0].new.actionArguments
    ).toEqual({
      duration: '3 secs'
    })
  })

  it('offers fallback, code generation, or cancel when controlled mode cannot find a skill', async () => {
    const nlu = testState.currentNlu as InstanceType<typeof NLUClass>

    nlu.nluProcessResult = {
      ...cloneDefaultProcessResult(),
      new: {
        utterance: 'Do something unknown',
        actionArguments: {},
        entities: [],
        sentiment: {}
      }
    }

    await (nlu as unknown as {
      handleSkillOrActionNotFound: () => Promise<void>
    }).handleSkillOrActionNotFound()

    expect(coreMocks.brain.talk).toHaveBeenCalledWith(
      expect.stringContaining('fall back to agent mode'),
      true
    )
    expect(coreMocks.brain.suggest).toHaveBeenCalledWith([
      'Fallback to agent mode',
      'Write the skill code',
      'Cancel'
    ])
  })
})
