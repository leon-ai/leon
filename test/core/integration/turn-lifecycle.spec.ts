import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import MemoryManager from '@/core/memory-manager/memory-manager'
import MemoryRepository from '@/core/memory-manager/memory-repository'
import SelfModelManager from '@/core/self-model-manager'
import PostTurnMaintenanceQueue from '@/core/post-turn-maintenance-queue'
import { ConversationLogger } from '@/conversation-logger'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { CONVERSATION_REPOSITORY } from '@/core/session-manager/conversation-repository'
import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { buildOwnerDocument, normalizeOwnerProfile } from '@/core/context-manager/owner-profile'
import { runTurnLifecycle } from '@/core/turn-lifecycle'
import { runTurnPhase, TurnPhase, TurnStage, readTurnHistory, recordTurnInference } from '@/core/llm-manager/turn-timing'
import { trackInferenceUsage } from '@/core/llm-manager/llm-usage'
import { readInferenceUsage } from '@/core/llm-manager/llm-usage/usage-ledger'
import { recordInferenceAttempt, recordInferenceUsage, recordInferenceUsageOutcome } from '@/core/llm-manager/llm-usage/usage-context'
import { InferencePurpose, LLMDuties, LLMProviders, type CompletionParams, type CompletionAttemptTiming } from '@/core/llm-manager/types'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { LogHelper } from '@/helpers/log-helper'

interface Services {
  queue: PostTurnMaintenanceQueue
  memory: MemoryManager
  self: SelfModelManager
  repository: MemoryRepository
  logger: ConversationLogger
}

const fixture = vi.hoisted(() => ({
  root: '',
  services: new Map<string, Services>(),
  requests: [] as { profile: string, purpose: string }[],
  releaseTitle: undefined as (() => void) | undefined,
  titleGate: undefined as Promise<void> | undefined,
  failExtraction: false
}))

vi.mock('@/constants', () => ({ CODEBASE_PATH: process.cwd() }))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { title: vi.fn(), info: vi.fn(), success: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() }
}))

vi.mock('@/config', () => ({
  CONFIG_MANAGER: { getConfig: (): { time_zone: string, runtime: { private_diary_enabled: boolean } } => ({ time_zone: 'UTC', runtime: { private_diary_enabled: true } }) }
}))
vi.mock('@/core/config-states/config-state', () => ({
  CONFIG_STATE: {
    getModelState: (): {
      getWorkflowProvider: () => string
      getWorkflowTarget: () => { provider: string }
      getAgentTargetValue: () => string
      getAgentTarget: () => { label: string, provider: string }
    } => ({
      getWorkflowProvider: (): string => 'openai',
      getWorkflowTarget: (): { provider: string } => ({ provider: 'openai' }),
      getAgentTargetValue: (): string => 'openai/fixture',
      getAgentTarget: (): { label: string, provider: string } => ({ label: 'openai/fixture', provider: 'openai' })
    }),
    getModelSettingsState: (): { getSettings: () => { reasoning: string, speed: string } } => ({
      getSettings: (): { reasoning: string, speed: string } => ({ reasoning: 'auto', speed: 'auto' })
    })
  }
}))
vi.mock('@/core/profile-runtime/profile-paths', async (load) => {
  const actual = await load<typeof import('@/core/profile-runtime/profile-paths')>()
  return { ...actual, getProfilePaths: (profile = getActiveProfileName()): ReturnType<typeof actual.getProfilePaths> => {
    const root = path.join(fixture.root, profile)
    return {
      ...actual.getProfilePaths(profile), root,
      sessions: path.join(root, 'sessions'), memory: path.join(root, 'memory'),
      context: path.join(root, 'context'), logs: path.join(root, 'logs')
    }
  } }
})
vi.mock('@/core/tool-manager/tool-settings', () => ({
  ToolSettings: { loadToolSettings: (): Record<string, unknown> => ({}) }
}))
vi.mock('@/core', () => ({
  MEMORY_MANAGER: new Proxy({}, { get: (_target, key): unknown => {
    const service = fixture.services.get(getActiveProfileName())!.memory
    const value = Reflect.get(service, key)
    return typeof value === 'function' ? value.bind(service) : value
  } }),
  SELF_MODEL_MANAGER: new Proxy({}, { get: (_target, key): unknown => {
    const service = fixture.services.get(getActiveProfileName())!.self
    const value = Reflect.get(service, key)
    return typeof value === 'function' ? value.bind(service) : value
  } }),
  POST_TURN_MAINTENANCE_QUEUE: new Proxy({}, { get: (_target, key): unknown => {
    const service = fixture.services.get(getActiveProfileName())!.queue
    const value = Reflect.get(service, key)
    return typeof value === 'function' ? value.bind(service) : value
  } }),
  LLM_PROVIDER: { prompt: (input: unknown, params: CompletionParams): ReturnType<typeof providerResponse> => providerResponse(input, params) },
  CONTEXT_MANAGER: { refreshOwnerContext: (): void => undefined },
  PERSONA: { refreshContextInfo: (): void => undefined }
}))

// Only the external model is simulated. Lifecycle, queue, managers and disk writes run normally.
async function providerResponse(_input: unknown, params: CompletionParams): Promise<{ output: unknown, usedInputTokens: number, usedOutputTokens: number }> {
  const purpose = params.usagePurpose ?? InferencePurpose.Memory
  const profile = getActiveProfileName()
  fixture.requests.push({ profile, purpose })
  return trackInferenceUsage({ provider: 'openai', model: 'fixture', purpose }, async () => {
    const attemptId = randomUUID()
    const startedAt = Date.now()
    recordInferenceAttempt(attemptId)
    const timing: CompletionAttemptTiming = {
      attemptId, startedAt, elapsedMs: 0,
      provider: LLMProviders.OpenAI, model: 'fixture', duty: LLMDuties.Inference,
      usagePurpose: purpose, transport: 'http', outcome: 'started',
      inferenceTimeoutMs: 1_000, streamIdleTimeoutMs: 1_000,
      providerEventCount: 1, providerCompleted: false, lastEvent: 'dispatched'
    }
    recordTurnInference(timing)
    if (purpose === InferencePurpose.SessionTitle && fixture.titleGate) {
      await fixture.titleGate
    }
    if (purpose === InferencePurpose.Memory && fixture.failExtraction) {
      recordInferenceUsageOutcome('failed')
      recordTurnInference({ ...timing, elapsedMs: Date.now() - startedAt, outcome: 'failed' })
      throw new Error('Fixture provider unavailable')
    }
    let output: unknown
    if (purpose === InferencePurpose.SessionTitle) {
      output = 'Home notes'
    } else if (purpose === InferencePurpose.Memory) {
      output = { items: [{ content: `The owner lives in ${profile}.`, evidence: `I live in ${profile}.`, scope: 'persistent' }] }
    } else if (purpose === InferencePurpose.SelfModel) {
      output = JSON.stringify({ retrospection: 'Keep remembered owner facts grounded in their words.' })
    } else if (params.systemPrompt?.startsWith('Verify owner')) {
      output = { safe: true, missingFacts: [] }
    } else if (params.systemPrompt?.startsWith('Extract a tiny')) {
      output = normalizeOwnerProfile({ owner_current_city: profile })
    } else {
      output = buildOwnerDocument(normalizeOwnerProfile({ homeAndImportantPlaces: [`Lives in ${profile}.`] }))
    }
    recordInferenceUsage({ input_tokens: 20, output_tokens: 5 })
    recordInferenceUsageOutcome('completed')
    recordTurnInference({
      ...timing, elapsedMs: Date.now() - startedAt, outcome: 'completed', providerCompleted: true, lastEvent: 'finish'
    })

    return { output, usedInputTokens: 20, usedOutputTokens: 5 }
  })
}

beforeEach(async () => {
  fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-turn-lifecycle-'))
  fixture.requests = []
  fixture.failExtraction = false
  fixture.titleGate = undefined
})

afterEach(async () => {
  fixture.releaseTitle?.()
  for (const [profile, services] of fixture.services) {
    await runWithProfileContext({ profileName: profile }, async () => {
      await services.queue.whenIdle()
      CONVERSATION_REPOSITORY.close()
      ;(services.repository as unknown as { db: Database }).db.close()
    })
  }
  fixture.services.clear()
  await fs.rm(fixture.root, { recursive: true, force: true })
})

async function createProfile(profile: string): Promise<void> {
  await runWithProfileContext({ profileName: profile }, async () => {
    const repository = new MemoryRepository()
    await Promise.all(['daily', 'discussion', 'persistent'].map((directory) =>
      fs.mkdir(path.join(getProfilePaths().memory, directory), { recursive: true })
    ))
    await repository.load(path.join(getProfilePaths().memory, 'memory.sqlite'))
    const memory = new MemoryManager()
    Object.assign(memory, { repository, _isLoaded: true })
    fixture.services.set(profile, {
      repository, memory, self: new SelfModelManager(), queue: new PostTurnMaintenanceQueue(),
      logger: new ConversationLogger({ loggerName: 'Lifecycle test', fileName: 'conversation_log.json', nbOfLogsToKeep: 100, nbOfLogsToLoad: 20 })
    })
  })
}

async function completeTurn(profile: string, explicitMemory = false): Promise<{ sessionId: string, turnId: string }> {
  return runWithProfileContext({ profileName: profile }, async () => {
    const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
    const turnId = randomUUID()
    const query = `I live in ${profile}. Please keep that in mind when helping me with local suggestions and other future questions.`
    const logger = fixture.services.get(profile)!.logger
    await runTurnLifecycle({ sessionId, turnId, query }, async () => {
      await logger.upsert({ who: 'owner', message: query, messageId: turnId, isAddedToHistory: true })
      const result = await runTurnPhase(TurnPhase.Execution, async () => ({
        output: 'I will keep that in mind.', data: {
          finalIntent: 'answer', hasExplicitMemoryWrite: explicitMemory, executionHistory: []
        }
      } as unknown as LLMDutyResult))
      await logger.upsert({ who: 'leon', message: String(result.output), messageId: `${turnId}:leon`, isAddedToHistory: true })
      return result
    })
    return { sessionId, turnId }
  })
}

it('persists title, memory, reflection and owner artifacts without blocking answer delivery', async () => {
  const profile = randomUUID()
  await createProfile(profile)
  const gate = Promise.withResolvers<void>()
  fixture.titleGate = gate.promise
  fixture.releaseTitle = (): void => gate.resolve()
  const { sessionId, turnId } = await completeTurn(profile)
  await runWithProfileContext({ profileName: profile }, async () => {
    expect(CONVERSATION_REPOSITORY.readAllMessages(sessionId)).toHaveLength(2)
    expect(CONVERSATION_SESSION_MANAGER.getSession(sessionId)?.isTitleGenerated).toBe(false)
    gate.resolve()
    await fixture.services.get(profile)!.queue.whenIdle()
    expect(CONVERSATION_SESSION_MANAGER.getSession(sessionId)?.title).toBe('Home notes')
    expect(fixture.services.get(profile)!.repository.listRecentPersistentContents()).toContain(`The owner lives in ${profile}.`)
    const context = getProfilePaths().context
    expect(await fs.readFile(path.join(context, 'OWNER.md'), 'utf8')).toContain(`Lives in ${profile}.`)
    expect(JSON.parse(await fs.readFile(path.join(context, '.owner-profile.json'), 'utf8')).owner_current_city).toBe(profile)
    expect(await fs.readFile(fixture.services.get(profile)!.self.getDiaryPath(), 'utf8')).toContain('grounded in their words')
    const history = []
    for await (const row of readTurnHistory({ turnId })) {
      history.push(row)
    }
    expect(history.filter((row) => row['kind'] === 'maintenance' && row['outcome'] === 'failed'),
      JSON.stringify(vi.mocked(LogHelper.warning).mock.calls)).toEqual([])
    expect(history.filter((row) => row['kind'] === 'maintenance' && row['outcome'] === 'completed')).toHaveLength(4)
    const usage = []
    for await (const row of readInferenceUsage({ turnId, stage: TurnStage.PostTurn })) {
      usage.push(row)
    }
    expect(usage.map((row) => row.purpose)).toEqual([
      InferencePurpose.SessionTitle, InferencePurpose.SelfModel, InferencePurpose.Memory,
      InferencePurpose.OwnerProfile, InferencePurpose.OwnerProfile, InferencePurpose.OwnerProfile
    ])
    expect(usage.every((row) => row.sessionId === sessionId && row.taskId && row.usage.inputTokens === 20)).toBe(true)
    expect(history.some((row) => row['goal'] === TurnPhase.OwnerVerification)).toBe(true)
    expect(history.filter((row) => row['kind'] === 'inference').every((row) => row['usageId'])).toBe(true)
    expect(history.some((row) => 'prompt' in row || 'reasoning' in row)).toBe(false)
  })
})

it('keeps concurrent profiles isolated and avoids extraction after explicit memory mutations', async () => {
  const profiles = [randomUUID(), randomUUID()]
  await Promise.all(profiles.map(createProfile))
  await Promise.all(profiles.map((profile) => completeTurn(profile, true)))
  await Promise.all(profiles.map(async (profile) => {
    await fixture.services.get(profile)!.queue.whenIdle()
    const purposes = fixture.requests.filter((request) => request.profile === profile).map((request) => request.purpose)
    expect(purposes).not.toContain(InferencePurpose.Memory)
    expect(purposes).toContain(InferencePurpose.OwnerProfile)
    expect(await fs.readFile(path.join(fixture.root, profile, 'context', 'OWNER.md'), 'utf8')).toContain(`Lives in ${profile}.`)
  }))
})

it('retains originating sessions and turns when one profile queues maintenance for multiple sessions', async () => {
  const profile = randomUUID()
  await createProfile(profile)
  const turns = await Promise.all([completeTurn(profile, true), completeTurn(profile, true)])
  await fixture.services.get(profile)!.queue.whenIdle()
  await runWithProfileContext({ profileName: profile }, async () => {
    for (const turn of turns) {
      const usage = []
      for await (const row of readInferenceUsage({ turnId: turn.turnId })) {
        usage.push(row)
      }
      expect(usage.length).toBeGreaterThan(0)
      expect(usage.every((row) => row.sessionId === turn.sessionId && row.stage === TurnStage.PostTurn)).toBe(true)
      expect(CONVERSATION_SESSION_MANAGER.getSession(turn.sessionId)?.title).toBe('Home notes')
    }
  })
})

it('records failed maintenance and continues the queue without changing the delivered answer', async () => {
  const profile = randomUUID()
  await createProfile(profile)
  const { turnId } = await completeTurn(profile)
  const queue = fixture.services.get(profile)!.queue
  await runWithProfileContext({ profileName: profile }, () => {
    queue.enqueue('failing task', () => {
      throw new Error('Fixture failure')
    })
    queue.enqueueIfNeeded('unneeded task', () => null)
  })
  await queue.whenIdle()
  await runWithProfileContext({ profileName: profile }, async () => {
    const records = []
    for await (const row of readTurnHistory({})) {
      records.push(row)
    }
    expect(records.some((row) => row['task'] === 'failing task' && row['outcome'] === 'failed')).toBe(true)
    expect(records.some((row) => row['task'] === 'unneeded task' && row['outcome'] === 'skipped')).toBe(true)
    expect(records.some((row) => row['turnId'] === turnId && row['stage'] === TurnStage.PostTurn)).toBe(true)
    expect(records.some((row) => JSON.stringify(row).includes('Fixture failure'))).toBe(false)
  })
})

it('retains failed background provider attempts without inventing tokens or losing the answer', async () => {
  const profile = randomUUID()
  await createProfile(profile)
  fixture.failExtraction = true
  const { sessionId, turnId } = await completeTurn(profile)
  await fixture.services.get(profile)!.queue.whenIdle()
  await runWithProfileContext({ profileName: profile }, async () => {
    expect(CONVERSATION_REPOSITORY.readAllMessages(sessionId)).toHaveLength(2)
    const usage = []
    for await (const record of readInferenceUsage({ turnId })) {
      usage.push(record)
    }
    expect(usage.find((record) => record.purpose === InferencePurpose.Memory)).toMatchObject({
      stage: TurnStage.PostTurn, outcome: 'failed', usage: {}
    })
    const history = []
    for await (const record of readTurnHistory({ turnId, stage: TurnStage.PostTurn })) {
      history.push(record)
    }
    expect(history.some((record) => record['kind'] === 'inference' && record['outcome'] === 'failed')).toBe(true)
  })
})

it('does not schedule successful-turn maintenance when foreground execution aborts', async () => {
  const profile = randomUUID()
  await createProfile(profile)
  await runWithProfileContext({ profileName: profile }, async () => {
    const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
    const turnId = randomUUID()
    const failure = new Error('Stopped before execution')
    await expect(runTurnLifecycle({ sessionId, turnId, query: 'Hello' }, async () => {
      throw failure
    })).rejects.toBe(failure)
    await fixture.services.get(profile)!.queue.whenIdle()
    const history = []
    for await (const record of readTurnHistory({ turnId })) {
      history.push(record)
    }
    expect(history.some((record) => record['kind'] === 'maintenance')).toBe(false)
    expect(history.some((record) => record['outcome'] === 'failed')).toBe(true)
  })
})
