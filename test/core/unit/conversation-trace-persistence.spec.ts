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

  it('restores one structured widget after replacement without adding it to model history', async () => {
    const logger = new ConversationLogger({
      loggerName: 'test',
      fileName: 'conversation_log.json',
      nbOfLogsToKeep: 100,
      nbOfLogsToLoad: 100
    })
    const widget = {
      id: 'connection-session-spotify',
      widget: 'ConnectionWidget',
      actionName: '',
      onFetch: null,
      historyMode: 'system_widget' as const,
      fallbackText: 'Connect Spotify',
      supportedEvents: [],
      componentTree: { component: 'WidgetWrapper', props: { children: [] } }
    }
    const record = {
      who: 'leon' as const,
      message: widget.fallbackText,
      messageId: widget.id,
      isAddedToHistory: false,
      widget
    }

    await logger.upsert(record, { sessionId: 'first' })
    await logger.upsert(record, { sessionId: 'first' })
    const logs = await logger.loadAll({ sessionId: 'first' })

    expect(logs).toHaveLength(1)
    expect(
      logs.filter(ConversationHistoryHelper.isAddedToHistory)
    ).toHaveLength(0)
    const visible = logs.filter((log) =>
      ConversationHistoryHelper.isVisibleInHistory(log)
    )
    const [history] = ConversationHistoryHelper.toHistoryItems(visible, {
      supportsWidgets: true
    })

    expect(history?.widget).toEqual(widget)
    expect(JSON.parse(history?.string || '')).toEqual(widget)
    const [fallback] = ConversationHistoryHelper.toHistoryItems(visible, {
      supportsWidgets: false
    })

    expect(fallback?.string).toBe('Connect Spotify')
    expect(fallback?.widget).toEqual(widget)
    expect(await logger.loadAll({ sessionId: 'second' })).toHaveLength(0)
  })

  it('preserves downloadable artifacts through serialization, reload and client history', async () => {
    const logger = new ConversationLogger({
      loggerName: 'test',
      fileName: 'conversation_log.json',
      nbOfLogsToKeep: 100,
      nbOfLogsToLoad: 100
    })
    const artifacts = [
      {
        id: 'artifact',
        session_id: 'first',
        filename: 'report.pdf',
        mime_type: 'application/pdf',
        size_bytes: 100,
        created_at: 1_000,
        source: 'document',
        url: '/api/v1/artifacts/first/artifact'
      }
    ]

    await logger.upsert(
      {
        who: 'leon',
        message: 'report.pdf',
        messageId: 'artifact-message',
        isAddedToHistory: true,
        artifacts
      },
      { sessionId: 'first' }
    )
    const logs = await logger.loadAll({ sessionId: 'first' })

    expect(logs[0]?.artifacts).toEqual(artifacts)
    expect(ConversationHistoryHelper.getModelMessage(logs[0]!)).toContain(
      '"artifact_id":"artifact"'
    )
    expect(
      ConversationHistoryHelper.toHistoryItems(logs, {
        supportsWidgets: false
      })[0]?.artifacts
    ).toEqual(artifacts)
  })

  it('saves partial activity outside model history and replaces it with one final answer', async () => {
    const logger = new ConversationLogger({
      loggerName: 'test', fileName: 'conversation_log.json', nbOfLogsToKeep: 100, nbOfLogsToLoad: 100
    })
    const draft: Omit<MessageLog, 'sentAt'> = {
      who: 'leon', message: '', messageId: 'turn', isAddedToHistory: false,
      agentResponseTrace: {
        id: 'turn', planSteps: [], toolCalls: [],
        progressMessages: [{
          id: 'progress',
          content: 'One item is verified; more remain.',
          createdAt: 1_000
        }],
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
      ...draft, messageId: 'request:leon', message: 'Done', isAddedToHistory: true,
      llmMetrics: {
        completionCount: 2, inputTokens: 100, outputTokens: 20, totalTokens: 120,
        durationMs: 100, tokensPerSecond: 200,
        usageAccounting: {
          cachedInputTokens: 80, cacheReadCompletionCount: 2, cacheWriteInputTokens: 0,
          costUSD: 0.001, costCompletionCount: 1, estimatedCostCompletionCount: 1,
          costSources: ['test pricing']
        }
      }
    }
    vi.mocked(Date.now).mockReturnValue(2_000)
    await Promise.all([
      logger.upsert(draft, { sessionId: 'first' }),
      logger.upsert(finished, { sessionId: 'first' })
    ])
    // Repeated delivery of a final answer must still update the same turn.
    await logger.upsert(finished, { sessionId: 'first' })
    expect(await logger.loadAll({ sessionId: 'first' })).toEqual([{ ...finished, sentAt: 2_000 }])
    const history = ConversationHistoryHelper.toHistoryItems(await logger.loadAll({ sessionId: 'first' }), { supportsWidgets: true })
    expect(history[0]?.agentResponseTrace?.progressMessages)
      .toEqual(draft.agentResponseTrace?.progressMessages)
    expect(history[0]?.llmMetrics?.usageAccounting).toEqual(finished.llmMetrics.usageAccounting)
    expect(history[0]?.llmMetrics?.completionCount).toBe(2)
    expect(await logger.loadAll({ sessionId: 'second' })).toEqual([{ ...draft, sentAt: 1_000 }])
  })
})
