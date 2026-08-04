import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeProfile: 'startup-profile',
  nextSessionId: 0,
  sessions: new Map<string, Set<string>>(),
  agentDutyParams: [] as Array<Record<string, unknown>>,
  persistedMessages: [] as Array<{
    profileId: string
    sessionId: string
    who: string
    message: string
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
  CONVERSATION_LOGGER: {
    upsert: vi.fn(
      async (
        record: { who: string, message: string },
        params: { sessionId: string }
      ) => {
        mocks.persistedMessages.push({
          profileId: mocks.activeProfile,
          sessionId: params.sessionId,
          who: record.who,
          message: record.message
        })
      }
    )
  },
  LLM_MANAGER: {
    isLLMEnabled: true
  }
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
    runWithSession: async <T>(
      _sessionId: string,
      callback: () => Promise<T>
    ): Promise<T> => callback(),
    maybeSetFallbackTitle: vi.fn()
  }
}))

vi.mock('@/core/llm-manager/llm-duties/react-llm-duty', () => ({
  ReActLLMDuty: class {
    constructor(params: Record<string, unknown>) {
      mocks.agentDutyParams.push(params)
    }

    async init(): Promise<void> {}

    async execute(): Promise<Record<string, unknown>> {
      return {
        output: 'Acknowledged.',
        data: {
          finalIntent: 'answer',
          executionHistory: []
        }
      }
    }
  }
}))

import {
  appendConversationMessage,
  runAgent
} from '@/core/http-server/http-plugins/leon-services'

describe('HTTP plugin Leon services', () => {
  beforeEach(() => {
    mocks.activeProfile = 'startup-profile'
    mocks.nextSessionId = 0
    mocks.sessions.clear()
    mocks.agentDutyParams.length = 0
    mocks.persistedMessages.length = 0
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
        allowDirectAnswerHandoff: false
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
        message: 'Remember the demo code 7742.'
      },
      {
        profileId: 'owner-a',
        sessionId: firstTurn.session_id,
        who: 'leon',
        message: 'Acknowledged.'
      },
      {
        profileId: 'owner-a',
        sessionId: firstTurn.session_id,
        who: 'owner',
        message: 'What is the demo code?'
      },
      {
        profileId: 'owner-a',
        sessionId: firstTurn.session_id,
        who: 'leon',
        message: 'Acknowledged.'
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
      message: 'It is overcast and 26C in Shenzhen.'
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

})
