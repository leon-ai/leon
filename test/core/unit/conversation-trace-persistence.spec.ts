import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationLogger } from '@/conversation-logger'
import { ConversationHistoryHelper } from '@/helpers/conversation-history-helper'
import type { MessageLog } from '@/types'

const sessions = vi.hoisted(() => ({ root: '' }))
vi.mock('@/core/session-manager', () => ({
  CONVERSATION_SESSION_MANAGER: {
    resolveConversationLogPath: (sessionId: string): string => `${sessions.root}/${sessionId}.json`,
    updateSessionFromLogs: vi.fn()
  }
}))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { title: vi.fn(), success: vi.fn(), error: vi.fn() }
}))

describe('conversation trace persistence', () => {
  beforeEach(async () => {
    sessions.root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-trace-'))
  })

  afterEach(async () => {
    await fs.rm(sessions.root, { recursive: true, force: true })
  })

  it('saves partial activity outside model history and replaces it with one final answer', async () => {
    const logger = new ConversationLogger({
      loggerName: 'test', fileName: 'conversation_log.json', nbOfLogsToKeep: 100, nbOfLogsToLoad: 100
    })
    const draft: Omit<MessageLog, 'sentAt'> = {
      who: 'leon', message: '', messageId: 'turn', isAddedToHistory: false,
      agentResponseTrace: {
        id: 'turn', planSteps: [], toolCalls: [],
        reasoning: [{ id: 'thinking', text: 'Checking $&', phase: 'agent', startedAt: 1_000 }]
      }
    }
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    await logger.upsert(draft, { sessionId: 'first' })
    const reloaded = await logger.loadAll({ sessionId: 'first' })
    expect(reloaded).toHaveLength(1)
    expect(reloaded.filter(ConversationHistoryHelper.isAddedToHistory)).toEqual([])
    expect(ConversationHistoryHelper.toHistoryItems(reloaded, { supportsWidgets: true })[0]?.agentResponseTrace)
      .toEqual(draft.agentResponseTrace)

    // A separate session can use the same request ID without crossing histories.
    await logger.upsert(draft, { sessionId: 'second' })
    const finished = {
      ...draft, messageId: 'request:leon', message: 'Done', isAddedToHistory: true
    }
    vi.mocked(Date.now).mockReturnValue(2_000)
    await Promise.all([
      logger.upsert(draft, { sessionId: 'first' }),
      logger.upsert(finished, { sessionId: 'first' })
    ])
    // Repeated delivery of a final answer must still update the same turn.
    await logger.upsert(finished, { sessionId: 'first' })
    expect(await logger.loadAll({ sessionId: 'first' })).toEqual([{ ...finished, sentAt: 2_000 }])
    expect(await logger.loadAll({ sessionId: 'second' })).toEqual([{ ...draft, sentAt: 1_000 }])
  })
})
