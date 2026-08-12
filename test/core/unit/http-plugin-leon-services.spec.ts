import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeProfile: 'startup-profile',
  activeSessionId: 'active-session',
  nextSessionId: 0,
  sessions: new Map<string, Set<string>>(),
  agentDutyParams: [] as Array<Record<string, unknown>>,
  controlledDutyParams: [] as Array<Record<string, unknown>>,
  controlledDutyOutputs: [] as Array<Array<Record<string, unknown>>>,
  agentDutyResult: {
    output: 'Acknowledged.',
    data: {
      finalIntent: 'answer',
      executionHistory: []
    }
  } as Record<string, unknown>,
  skillActions: [] as Array<Record<string, unknown>>,
  maintenanceTasks: [] as Array<{ label: string, task: () => unknown }>,
  ownerProfileSyncCalls: [] as Array<{
    userMessage: string
    assistantMessage: string
    toolExecutions: Array<Record<string, unknown>>
  }>,
  skillAnswer: 'Done — I’ve applied that.',
  nluProcessResult: {
    context: {
      utterances: [],
      actionArguments: [],
      entities: []
    },
    new: {
      utterance: '',
      actionArguments: {}
    },
    skillName: '',
    actionName: ''
  } as Record<string, unknown>,
  persistedMessages: [] as Array<{
    profileId: string
    sessionId: string
    who: string
    message: string
    sentAt: number
    messageId?: string
    llmMetrics?: Record<string, unknown>
  }>
}))

function getProfileSessions(): Set<string> {
  let sessions = mocks.sessions.get(mocks.activeProfile)

  if (!sessions) {
    sessions = new Set<string>()
    mocks.sessions.set(mocks.activeProfile, sessions)
  }

  return sessions
}

vi.mock('@/core', () => ({
  BRAIN: {
    isMuted: false,
    runSkillAction: vi.fn(async (nluProcessResult: Record<string, unknown>) => {
      mocks.skillActions.push(structuredClone(nluProcessResult))
      return {
        lastOutputFromSkill: {
          answer: mocks.skillAnswer
        }
      }
    })
  },
  CONVERSATION_LOGGER: {
    load: vi.fn(async (params?: {
      sessionId?: string
      nbOfLogsToLoad?: number
    }) => mocks.persistedMessages
      .filter((message) =>
        message.profileId === mocks.activeProfile &&
        message.sessionId === (params?.sessionId || mocks.activeSessionId)
      )
      .slice(-(params?.nbOfLogsToLoad || mocks.persistedMessages.length))
      .map((message) => ({
        who: message.who,
        message: message.message,
        sentAt: message.sentAt,
        isAddedToHistory: true,
        ...(message.messageId ? { messageId: message.messageId } : {}),
        ...(message.llmMetrics ? { llmMetrics: message.llmMetrics } : {})
      }))),
    upsert: vi.fn(
      async (
        record: {
          who: string
          message: string
          messageId?: string
          llmMetrics?: Record<string, unknown>
        },
        params: { sessionId: string }
      ) => {
        mocks.persistedMessages.push({
          profileId: mocks.activeProfile,
          sessionId: params.sessionId,
          who: record.who,
          message: record.message,
          sentAt: mocks.persistedMessages.length + 1,
          ...(record.messageId ? { messageId: record.messageId } : {}),
          ...(record.llmMetrics ? { llmMetrics: record.llmMetrics } : {})
        })
      }
    )
  },
  LLM_MANAGER: {
    isLLMEnabled: true
  },
  NLU: {
    get nluProcessResult(): Record<string, unknown> {
      return mocks.nluProcessResult
    },
    set nluProcessResult(value: Record<string, unknown>) {
      mocks.nluProcessResult = value
    }
  },
  POST_TURN_MAINTENANCE_QUEUE: {
    enqueue: vi.fn((label: string, task: () => unknown) => {
      mocks.maintenanceTasks.push({ label, task })
      void task()
    })
  }
}))

vi.mock('@/core/context-manager/owner-profile-sync', () => ({
  syncOwnerProfileFromTurn: vi.fn(async (
    userMessage: string,
    assistantMessage: string,
    toolExecutions: Array<Record<string, unknown>>
  ) => {
    mocks.ownerProfileSyncCalls.push({
      userMessage,
      assistantMessage,
      toolExecutions
    })

    return { profileChanged: true, contextChanged: true }
  })
}))

vi.mock('@/core/profile-runtime/profile-context', () => ({
  getActiveProfileName: (): string => mocks.activeProfile,
  runWithProfileContext: async <T>(
    context: { profileName: string },
    callback: () => Promise<T>
  ): Promise<T> => {
    const previousProfile = mocks.activeProfile
    mocks.activeProfile = context.profileName

    try {
      return await callback()
    } finally {
      mocks.activeProfile = previousProfile
    }
  }
}))

vi.mock('@/core/profile-runtime/initialize-profile-runtime', () => ({
  ensureActiveProfileRuntime: vi.fn(async () => undefined)
}))

vi.mock('@/core/session-manager', () => ({
  CONVERSATION_SESSION_MANAGER: {
    getSession: (sessionId: string): { id: string } | null =>
      getProfileSessions().has(sessionId) ? { id: sessionId } : null,
    createSession: (): { id: string } => {
      const id = `session-${++mocks.nextSessionId}`
      getProfileSessions().add(id)

      return { id }
    },
    getActiveSessionId: (): string =>
      [...getProfileSessions()][0] || 'active-session',
    listSessions: (): Array<Record<string, unknown>> =>
      [...getProfileSessions()].map((id, index) => ({
        id,
        title: `Session ${index + 1}`,
        isTitleGenerated: true,
        isPinned: index === 0,
        createdAt: index + 1,
        updatedAt: index + 2,
        lastMessageAt: index + 2,
        messageCount: 2,
        modelTarget: null
      })),
    runWithSession: async <T>(
      sessionId: string,
      callback: () => Promise<T>
    ): Promise<T> => {
      const previousSessionId = mocks.activeSessionId
      mocks.activeSessionId = sessionId

      try {
        return await callback()
      } finally {
        mocks.activeSessionId = previousSessionId
      }
    },
    maybeSetFallbackTitle: vi.fn()
  }
}))

vi.mock('@/core/llm-manager/llm-duties/action-calling-llm-duty', () => ({
  ActionCallingLLMDuty: class {
    constructor(params: Record<string, unknown>) {
      mocks.controlledDutyParams.push(params)
    }

    async init(): Promise<void> {}

    async execute(): Promise<Record<string, unknown>> {
      return {
        output: JSON.stringify(mocks.controlledDutyOutputs.shift() || [
          { status: 'not_found' }
        ])
      }
    }
  }
}))

vi.mock('@/core/nlp/nlu/nlu-process-result-updater', () => ({
  DEFAULT_NLU_PROCESS_RESULT: {
    context: {
      utterances: [],
      actionArguments: [],
      entities: []
    },
    new: {
      utterance: '',
      actionArguments: {}
    },
    skillName: '',
    actionName: ''
  },
  NLUProcessResultUpdater: {
    update: vi.fn(async (update: Record<string, unknown>) => {
      mocks.nluProcessResult = {
        ...mocks.nluProcessResult,
        ...update,
        new: {
          ...(mocks.nluProcessResult['new'] as Record<string, unknown>),
          ...((update['new'] as Record<string, unknown> | undefined) || {})
        }
      }
    })
  }
}))

vi.mock('@/core/llm-manager/llm-duties/react-llm-duty', () => ({
  ReActLLMDuty: class {
    constructor(params: Record<string, unknown>) {
      mocks.agentDutyParams.push(params)
    }

    async init(): Promise<void> {}

    async execute(): Promise<Record<string, unknown>> {
      return structuredClone(mocks.agentDutyResult)
    }
  }
}))

import {
  appendConversationMessage,
  getConversationHistory,
  listConversationSessions,
  runAgent,
  runControlledSkill
} from '@/core/http-server/http-plugins/leon-services'

describe('HTTP plugin Leon services', () => {
  beforeEach(() => {
    mocks.activeProfile = 'startup-profile'
    mocks.activeSessionId = 'active-session'
    mocks.nextSessionId = 0
    mocks.sessions.clear()
    mocks.agentDutyParams.length = 0
    mocks.controlledDutyParams.length = 0
    mocks.controlledDutyOutputs.length = 0
    mocks.agentDutyResult = {
      output: 'Acknowledged.',
      data: {
        finalIntent: 'answer',
        executionHistory: []
      }
    }
    mocks.skillActions.length = 0
    mocks.maintenanceTasks.length = 0
    mocks.ownerProfileSyncCalls.length = 0
    mocks.skillAnswer = 'Done — I’ve applied that.'
    mocks.nluProcessResult = {
      context: {
        utterances: [],
        actionArguments: [],
        entities: []
      },
      new: {
        utterance: '',
        actionArguments: {}
      },
      skillName: '',
      actionName: ''
    }
    mocks.persistedMessages.length = 0
  })

  it('executes and persists one matched controlled action', async () => {
    mocks.controlledDutyOutputs.push([
      {
        status: 'success',
        name: 'start_timer',
        arguments: { duration_minutes: 15 }
      }
    ])

    const result = await runControlledSkill({
      profile_id: 'owner-a',
      query: 'Start a timer for 15 minutes.',
      skill_name: 'timer_skill',
      fallback_action_name: 'fallback_to_agent',
      create_session: true,
      request_id: 'turn-1'
    })

    expect(result).toMatchObject({
      matched: true,
      status: 'success',
      answer: 'Done — I’ve applied that.',
      action: {
        name: 'start_timer',
        input: { duration_minutes: 15 }
      }
    })
    expect(mocks.skillActions).toHaveLength(1)
    expect(mocks.persistedMessages.map(({ who, message }) => ({
      who,
      message
    }))).toEqual([
      { who: 'owner', message: 'Start a timer for 15 minutes.' },
      { who: 'leon', message: 'Done — I’ve applied that.' }
    ])
  })

  it('leaves an explicit fallback action uncommitted for agent mode', async () => {
    mocks.controlledDutyOutputs.push([
      {
        status: 'success',
        name: 'fallback_to_agent',
        arguments: {}
      }
    ])

    const result = await runControlledSkill({
      profile_id: 'owner-a',
      query: 'Summarize the latest research on renewable energy.',
      skill_name: 'timer_skill',
      fallback_action_name: 'fallback_to_agent',
      create_session: true
    })

    expect(result).toMatchObject({
      matched: false,
      status: 'not_found',
      action: null
    })
    expect(mocks.skillActions).toHaveLength(0)
    expect(mocks.persistedMessages).toHaveLength(0)
  })

  it('forwards trusted additional instructions to the agent duty', async () => {
    await runAgent({
      profile_id: 'owner-a',
      query: 'Check the weather.',
      create_session: true,
      additionalInstructions: 'Acknowledge pending background work.'
    })

    expect(mocks.agentDutyParams).toEqual([
      {
        input: 'Check the weather.',
        additionalInstructions: 'Acknowledge pending background work.',
        allowDirectAnswerHandoff: false,
        onProgressEvent: expect.any(Function)
      }
    ])
  })

  it('persists coherent turns inside the requested profile and session', async () => {
    const firstTurn = await runAgent({
      profile_id: 'owner-a',
      query: 'Remember the demo code 7742.',
      create_session: true,
      request_id: 'turn-1'
    })
    await runAgent({
      profile_id: 'owner-a',
      query: 'What is the demo code?',
      session_id: firstTurn.session_id || undefined,
      request_id: 'turn-2'
    })

    expect(mocks.persistedMessages).toEqual([
      {
        profileId: 'owner-a',
        sessionId: firstTurn.session_id,
        who: 'owner',
        message: 'Remember the demo code 7742.',
        sentAt: 1,
        messageId: 'turn-1'
      },
      {
        profileId: 'owner-a',
        sessionId: firstTurn.session_id,
        who: 'leon',
        message: 'Acknowledged.',
        sentAt: 2,
        messageId: 'turn-1:leon'
      },
      {
        profileId: 'owner-a',
        sessionId: firstTurn.session_id,
        who: 'owner',
        message: 'What is the demo code?',
        sentAt: 3,
        messageId: 'turn-2'
      },
      {
        profileId: 'owner-a',
        sessionId: firstTurn.session_id,
        who: 'leon',
        message: 'Acknowledged.',
        sentAt: 4,
        messageId: 'turn-2:leon'
      }
    ])
  })

  it('syncs the owner profile after an explicit HTTP agent memory write', async () => {
    const observation = JSON.stringify({
      data: {
        parsed_input: {
          content: 'The owner lives in Shenzhen.'
        }
      }
    })
    mocks.agentDutyResult = {
      output: 'I will remember that you live in Shenzhen.',
      data: {
        finalIntent: 'answer',
        hasExplicitMemoryWrite: true,
        executionHistory: [
          {
            function: 'structured_knowledge.memory.write',
            status: 'success',
            observation
          }
        ]
      }
    }

    await runAgent({
      profile_id: 'owner-a',
      query: 'I live in Shenzhen. Remember that.',
      create_session: true
    })

    expect(mocks.maintenanceTasks.map(({ label }) => label)).toEqual([
      'owner profile sync'
    ])
    expect(mocks.ownerProfileSyncCalls).toEqual([
      {
        userMessage: 'I live in Shenzhen. Remember that.',
        assistantMessage: 'I will remember that you live in Shenzhen.',
        toolExecutions: [
          {
            functionName: 'structured_knowledge.memory.write',
            status: 'success',
            observation
          }
        ]
      }
    ])
  })

  it('keeps profile runtime sessions isolated', async () => {
    const firstOwner = await runAgent({
      profile_id: 'owner-a',
      query: 'Owner A turn.',
      create_session: true
    })
    const secondOwner = await runAgent({
      profile_id: 'owner-b',
      query: 'Owner B turn.',
      create_session: true
    })

    expect(firstOwner.profile_id).toBe('owner-a')
    expect(secondOwner.profile_id).toBe('owner-b')
    expect(firstOwner.session_id).not.toBe(secondOwner.session_id)
    expect(new Set(
      mocks.persistedMessages.map((message) => message.profileId)
    )).toEqual(new Set(['owner-a', 'owner-b']))
  })

  it('appends an external assistant message to an existing profile session', async () => {
    const turn = await runAgent({
      profile_id: 'owner-a',
      query: 'Check the weather in Shenzhen.',
      create_session: true
    })

    const result = await appendConversationMessage({
      profile_id: 'owner-a',
      session_id: turn.session_id || '',
      role: 'assistant',
      message: 'It is overcast and 26C in Shenzhen.',
      message_id: 'background-job-1'
    })

    expect(result).toEqual({
      profile_id: 'owner-a',
      session_id: turn.session_id,
      role: 'assistant',
      message_id: 'background-job-1'
    })
    expect(mocks.persistedMessages.at(-1)).toEqual({
      profileId: 'owner-a',
      sessionId: turn.session_id,
      who: 'leon',
      message: 'It is overcast and 26C in Shenzhen.',
      sentAt: 3,
      messageId: 'background-job-1'
    })
  })

  it('rejects an external message for another profile session', async () => {
    const turn = await runAgent({
      profile_id: 'owner-a',
      query: 'Owner A turn.',
      create_session: true
    })

    await expect(appendConversationMessage({
      profile_id: 'owner-b',
      session_id: turn.session_id || '',
      role: 'assistant',
      message: 'This must not cross profiles.'
    })).rejects.toThrow('does not exist in profile "owner-b"')
  })

  it('lists sessions inside the requested profile', async () => {
    await runAgent({
      profile_id: 'owner-a',
      query: 'Owner A turn.',
      create_session: true
    })

    const result = await listConversationSessions({ profile_id: 'owner-a' })

    expect(result.profile_id).toBe('owner-a')
    expect(result.active_session_id).toBe('session-1')
    expect(result.sessions).toEqual([
      {
        id: 'session-1',
        title: 'Session 1',
        is_pinned: true,
        created_at: 1,
        updated_at: 2,
        last_message_at: 2,
        message_count: 2
      }
    ])
  })

  it('reads persisted history without crossing profile sessions', async () => {
    const turn = await runAgent({
      profile_id: 'owner-a',
      query: 'Remember this.',
      create_session: true,
      request_id: 'turn-1'
    })

    const result = await getConversationHistory({
      profile_id: 'owner-a',
      session_id: turn.session_id || ''
    })

    expect(result).toEqual({
      profile_id: 'owner-a',
      session_id: 'session-1',
      messages: [
        {
          role: 'owner',
          content: 'Remember this.',
          created_at: 1,
          message_id: 'turn-1',
          metrics: null,
          response_trace: null
        },
        {
          role: 'assistant',
          content: 'Acknowledged.',
          created_at: 2,
          message_id: 'turn-1:leon',
          metrics: null,
          response_trace: null
        }
      ]
    })

    await expect(getConversationHistory({
      profile_id: 'owner-b',
      session_id: turn.session_id || ''
    })).rejects.toThrow('does not exist in profile "owner-b"')
  })

})
