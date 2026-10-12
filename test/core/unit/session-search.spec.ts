import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { searchConversationSessions } from '@/core/session-manager/session-search'

interface TestSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

interface TestMessage {
  who: 'owner' | 'leon'
  sentAt: number
  message: string
  isAddedToHistory: boolean
}

const CURRENT_SESSION_ID = 'current-session'
const CAMERA_SESSION_ID = 'camera-decision'
const RESEARCH_SESSION_ID = 'camera-research'
const ASSISTANT_SESSION_ID = 'assistant-claim'

function createSession(id: string, title: string, timestamp: number): TestSession {
  return {
    id,
    title,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

describe('session search', () => {
  let sessionsPath = ''

  beforeEach(async () => {
    sessionsPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'leon-session-search-')
    )
  })

  afterEach(async () => {
    await fs.promises.rm(sessionsPath, { recursive: true, force: true })
  })

  async function writeArchive(
    sessions: TestSession[],
    logs: Record<string, TestMessage[]>,
    activeSessionId = CURRENT_SESSION_ID
  ): Promise<void> {
    await fs.promises.writeFile(
      path.join(sessionsPath, 'index.json'),
      JSON.stringify({ activeSessionId, sessions }),
      'utf8'
    )

    await Promise.all(
      Object.entries(logs).map(async ([sessionId, messages]) => {
        const sessionPath = path.join(sessionsPath, sessionId)
        await fs.promises.mkdir(sessionPath, { recursive: true })
        await fs.promises.writeFile(
          path.join(sessionPath, 'conversation_log.json'),
          JSON.stringify(messages),
          'utf8'
        )
      })
    )
  }

  it('finds direct owner evidence with nearby turns and excludes the current session', async () => {
    const currentSession = createSession(
      CURRENT_SESSION_ID,
      'Current question',
      4_000
    )
    const cameraSession = createSession(
      CAMERA_SESSION_ID,
      'Camera decision',
      2_000
    )
    const researchSession = createSession(
      RESEARCH_SESSION_ID,
      'Pocket camera research',
      3_000
    )

    await writeArchive(
      [currentSession, cameraSession, researchSession],
      {
        [CURRENT_SESSION_ID]: [
          {
            who: 'owner',
            sentAt: 4_000,
            message: 'Do you know which camera I own?',
            isAddedToHistory: true
          }
        ],
        [CAMERA_SESSION_ID]: [
          {
            who: 'leon',
            sentAt: 2_000,
            message: 'Which camera did you decide to keep?',
            isAddedToHistory: true
          },
          {
            who: 'owner',
            sentAt: 2_001,
            message: 'I returned Luna Ultra and kept Pocket 4P.',
            isAddedToHistory: true
          },
          {
            who: 'leon',
            sentAt: 2_002,
            message: 'That sounds like the better fit.',
            isAddedToHistory: true
          }
        ],
        [RESEARCH_SESSION_ID]: [
          {
            who: 'owner',
            sentAt: 3_000,
            message: 'Research Pocket 4P stabilization settings.',
            isAddedToHistory: true
          }
        ]
      }
    )

    const result = await searchConversationSessions({
      sessionsPath,
      query: 'kept Pocket 4P',
      role: 'owner',
      currentSessionId: CURRENT_SESSION_ID
    })

    expect(result.searchedSessions).toBe(2)
    expect(result.searchedMessages).toBe(4)
    expect(result.hits[0]?.sessionId).toBe(CAMERA_SESSION_ID)
    expect(result.hits[0]?.match.who).toBe('owner')
    expect(result.hits[0]?.match.message).toContain('kept Pocket 4P')
    expect(result.hits[0]?.context.map(({ who }) => who)).toEqual([
      'leon',
      'owner',
      'leon'
    ])
    expect(result.hits.some(({ sessionId }) => sessionId === CURRENT_SESSION_ID))
      .toBe(false)
  })

  it('filters direct matches by author while preserving both authors in context', async () => {
    const assistantSession = createSession(
      ASSISTANT_SESSION_ID,
      'Earlier recommendation',
      1_000
    )

    await writeArchive(
      [assistantSession],
      {
        [ASSISTANT_SESSION_ID]: [
          {
            who: 'owner',
            sentAt: 1_000,
            message: 'What did you recommend?',
            isAddedToHistory: true
          },
          {
            who: 'leon',
            sentAt: 1_001,
            message: 'My unverified recommendation was the Aurora Camera.',
            isAddedToHistory: true
          }
        ]
      },
      ''
    )

    const ownerResult = await searchConversationSessions({
      sessionsPath,
      query: 'Aurora Camera',
      role: 'owner'
    })
    const bothResult = await searchConversationSessions({
      sessionsPath,
      query: 'Aurora Camera',
      role: 'both'
    })

    expect(ownerResult.hits).toEqual([])
    expect(bothResult.hits).toHaveLength(1)
    expect(bothResult.hits[0]?.match.who).toBe('leon')
    expect(bothResult.hits[0]?.context.map(({ who }) => who)).toEqual([
      'owner',
      'leon'
    ])
  })

  it('returns only the strongest match from each session', async () => {
    const cameraSession = createSession(
      CAMERA_SESSION_ID,
      'Pocket notes',
      2_000
    )
    const researchSession = createSession(
      RESEARCH_SESSION_ID,
      'Pocket accessories',
      3_000
    )

    await writeArchive(
      [cameraSession, researchSession],
      {
        [CAMERA_SESSION_ID]: [
          {
            who: 'owner',
            sentAt: 2_000,
            message: 'Pocket 4P notes.',
            isAddedToHistory: true
          },
          {
            who: 'owner',
            sentAt: 2_001,
            message: 'Pocket 4P is the one I kept.',
            isAddedToHistory: true
          }
        ],
        [RESEARCH_SESSION_ID]: [
          {
            who: 'owner',
            sentAt: 3_000,
            message: 'Pocket 4P accessory research.',
            isAddedToHistory: true
          }
        ]
      },
      ''
    )

    const result = await searchConversationSessions({
      sessionsPath,
      query: 'Pocket 4P',
      role: 'owner',
      contextWindow: 0
    })

    expect(result.hits).toHaveLength(2)
    expect(new Set(result.hits.map(({ sessionId }) => sessionId)).size).toBe(2)
    expect(result.hits.every(({ context }) => context.length === 1)).toBe(true)
  })

  it('gracefully skips missing and malformed session logs', async () => {
    const validSession = createSession('valid-session', 'Valid', 1_000)
    const missingSession = createSession('missing-session', 'Missing', 2_000)
    const malformedSession = createSession('malformed-session', 'Bad', 3_000)

    await writeArchive(
      [validSession, missingSession, malformedSession],
      {
        [validSession.id]: [
          {
            who: 'owner',
            sentAt: 1_000,
            message: 'Evidence survives.',
            isAddedToHistory: true
          }
        ]
      },
      ''
    )
    await fs.promises.mkdir(path.join(sessionsPath, malformedSession.id))
    await fs.promises.writeFile(
      path.join(
        sessionsPath,
        malformedSession.id,
        'conversation_log.json'
      ),
      '{broken',
      'utf8'
    )

    const result = await searchConversationSessions({
      sessionsPath,
      query: 'Evidence'
    })

    expect(result.searchedSessions).toBe(1)
    expect(result.hits.map(({ sessionId }) => sessionId)).toEqual([
      validSession.id
    ])
  })
})
