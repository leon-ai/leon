import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationLogger } from '@/conversation-logger'
import { ConversationHistoryHelper } from '@/helpers/conversation-history-helper'
import Brain from '@/core/brain/brain'
import PulseManager from '@/core/pulse-manager'
import { CONFIG_MANAGER } from '@/config'
import { ParaphraseLLMDuty } from '@/core/llm-manager/llm-duties/paraphrase-llm-duty'
import type { LLMAnswerMetrics, MessageLog } from '@/types'
import {
  getActiveTurnInference,
  recordTurnInference,
  runWithConversationSession
} from '@/core/session-manager/session-context'
import {
  createInferenceMetadata,
  InferenceAuthMode,
  InferenceCredentialSource
} from '@/core/llm-manager/inference-metadata'
import { runWithProfileContext } from '@/core/profile-runtime/profile-context'

const sessions = vi.hoisted(() => ({ root: '' }))
const answerRuntime = vi.hoisted(() => ({
  CONVERSATION_LOGGER: null as ConversationLogger | null,
  NLU: { currentResponseRoute: 'controlled', nluResult: {} },
  SOCKET_SERVER: {
    emitAnswerToChatClients: vi.fn(),
    emitToChatClients: vi.fn()
  },
  POST_TURN_MAINTENANCE_QUEUE: { enqueue: vi.fn() },
  TTS: { add: vi.fn() }
}))
vi.mock('@/core', () => {
  return answerRuntime
})
vi.mock('@/core/session-manager', () => ({
  CONVERSATION_SESSION_MANAGER: {
    resolveConversationLogPath: (sessionId: string): string => `${sessions.root}/${sessionId}.json`,
    updateSessionFromLogs: vi.fn()
  }
}))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { title: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

describe('conversation trace persistence', () => {
  beforeEach(async () => {
    sessions.root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-trace-'))
  })

  afterEach(async () => {
    vi.clearAllTimers()
    vi.useRealTimers()
    await fs.rm(sessions.root, { recursive: true, force: true })
  })

  it('delivers pulse metrics and trace through the ordinary answer queue and history', async () => {
    vi.useFakeTimers()
    const config = CONFIG_MANAGER.getConfig()
    vi.spyOn(CONFIG_MANAGER, 'getConfig').mockReturnValue({
      ...config,
      runtime: { ...config.runtime, pulse_enabled: false }
    })
    const logger = new ConversationLogger({
      loggerName: 'test', fileName: 'conversation_log.json',
      nbOfLogsToKeep: 100, nbOfLogsToLoad: 100
    })
    answerRuntime.CONVERSATION_LOGGER = logger
    const brain = new Brain()
    const pulse = new PulseManager()
    const paraphrase = vi.spyOn(ParaphraseLLMDuty.prototype, 'execute')
    const output = 'I checked your upcoming calendar and prepared your meeting notes.'
    const llmMetrics: LLMAnswerMetrics = {
      completionCount: 2, inputTokens: 100, outputTokens: 20, totalTokens: 120,
      durationMs: 1_000, tokensPerSecond: 20, ttftMs: 100,
      usageAccounting: {
        cachedInputTokens: 80, cacheReadCompletionCount: 1,
        cacheWriteInputTokens: 0, costUSD: 0,
        costCompletionCount: 0, estimatedCostCompletionCount: 0, costSources: []
      }
    }
    const agentResponseTrace = { id: 'pulse-turn', metrics: llmMetrics }
    Object.assign(pulse, {
      persist: vi.fn(),
      loadCoreNodes: async () => ({
        ...answerRuntime,
        BRAIN: brain,
        MEMORY_MANAGER: { observeTurn: vi.fn() }
      }),
      loadReActLLMDuty: async () => ({
        ReActLLMDuty: class {
          public async init(): Promise<void> {
            return
          }

          public async execute(): Promise<unknown> {
            return { output, data: { llmMetrics, agentResponseTrace } }
          }
        }
      })
    })
    const matter = {
      id: 'pulse-matter', fingerprint: 'meeting-notes', intentKey: 'prepare',
      targetScope: 'calendar', turnPrompt: 'Prepare meeting notes.',
      summary: 'Prepare meeting notes', why: 'An upcoming meeting', notifyOwner: true
    } as Parameters<PulseManager['executeMatter']>[1]
    const state = {
      matters: [matter], recentOutcomes: [], suppressionPolicies: [], recentTicks: []
    } as Parameters<PulseManager['executeMatter']>[0]

    await pulse['executeMatter'](state, matter)

    expect(answerRuntime.SOCKET_SERVER.emitAnswerToChatClients)
      .toHaveBeenCalledExactlyOnceWith({ answer: output, llmMetrics, agentResponseTrace })
    const history = ConversationHistoryHelper.toHistoryItems(
      await logger.loadAll(), { supportsWidgets: false }
    )
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      originalString: output, llmMetrics, agentResponseTrace
    })
    expect(paraphrase).not.toHaveBeenCalled()
    expect(answerRuntime.POST_TURN_MAINTENANCE_QUEUE.enqueue.mock.calls.map(([label]) => label))
      .toEqual(['pulse self-model reflection', 'session title generation'])
  })

  it('persists distinct turn routes without credentials and keeps older attribution unknown', async () => {
    const logger = new ConversationLogger({
      loggerName: 'test',
      fileName: 'conversation_log.json',
      nbOfLogsToKeep: 100,
      nbOfLogsToLoad: 100
    })
    const account = createInferenceMetadata({
      provider: 'openai',
      model: 'account-model',
      authMode: InferenceAuthMode.ChatGPTOAuth,
      credentialSource: InferenceCredentialSource.AccountBinding,
      connectionId: 'private-account-id',
      endpoint: 'wss://private-user:private-password@api.openai.com/v1/responses?token=private-token#private-fragment'
    })
    const apiKey = createInferenceMetadata({
      provider: 'openai',
      model: 'api-model',
      authMode: InferenceAuthMode.APIKey,
      credentialSource: InferenceCredentialSource.ProfileAPIKey,
      endpoint: 'wss://api.openai.com/v1/responses'
    })
    const message = {
      who: 'leon' as const,
      message: 'Done',
      isAddedToHistory: true
    }

    await logger.upsert(message, { sessionId: 'first' })
    await runWithConversationSession({ sessionId: 'first' }, async () => {
      await logger.upsert(message, { sessionId: 'first' })
      recordTurnInference(account)
      recordTurnInference(account)
      await logger.upsert(message, { sessionId: 'first' })

      await runWithConversationSession({ sessionId: 'first' }, async () => {
        recordTurnInference(apiKey)
      })
      const snapshot = getActiveTurnInference()
      await logger.upsert(message, { sessionId: 'first' })

      await runWithConversationSession({ sessionId: 'second' }, async () => {
        expect(getActiveTurnInference()).toBeNull()
        await logger.upsert(message, { sessionId: 'second' })
      })
      await runWithProfileContext({ profileName: 'another-profile' }, async () => {
        await runWithConversationSession({ sessionId: 'first' }, async () => {
          expect(getActiveTurnInference()).toBeNull()
          recordTurnInference(apiKey)
          expect(getActiveTurnInference()).toEqual(apiKey)
        })
      })
      expect(getActiveTurnInference()).toEqual(snapshot)
    })

    const history = ConversationHistoryHelper.toHistoryItems(
      await logger.loadAll({ sessionId: 'first' }),
      { supportsWidgets: false }
    )
    expect(history.map((item) => item.inference)).toEqual([
      undefined,
      null,
      account,
      [account, apiKey]
    ])
    expect(history[0]).not.toHaveProperty('inference')
    expect(account.endpoint).toBe('wss://api.openai.com/v1/responses')
    expect(account.connectionRef).toHaveLength(12)
    expect(JSON.stringify(history)).not.toContain('private-')
    expect(createInferenceMetadata({
      ...apiKey,
      endpoint: 'https://proxy.example/private-key/private%2Fkey/v1/responses',
      privateValues: ['private-key', 'private/key']
    }).endpoint).toBe('https://proxy.example/[REDACTED]/[REDACTED]/v1/responses')
    expect((await logger.loadAll({ sessionId: 'second' }))[0]?.inference).toBeNull()
    expect(getActiveTurnInference()).toBeUndefined()
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
