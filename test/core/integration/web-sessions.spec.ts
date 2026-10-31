import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationLogger } from '@/conversation-logger'
import { POST_TURN_MAINTENANCE_QUEUE } from '@/core'
import { sessionsPlugin } from '@/core/http-server/api/sessions'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { CONVERSATION_REPOSITORY } from '@/core/session-manager/conversation-repository'
import { WEB_SESSION_RUNTIME } from '@/core/session-manager/web-session-runtime'
import { enterProfileContext, getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import type { ReactLLMDutyParams } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-types'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import type { ProfilePaths } from '@/core/profile-runtime/profile-paths'
import { applyConversationEvent } from '../../../apps/web/src/data/conversation-events'
import { toFeedEntry } from '../../../apps/web/src/data/conversation-feed'
import type { ConversationRecord, ConversationEvent } from '../../../apps/web/src/data/conversation'

const fixture = vi.hoisted(() => ({
  root: '',
  logger: null as ConversationLogger | null,
  executions: [] as { profile: string, session: string, query: string, target: string, release: () => void }[]
}))

vi.mock('@/core', () => ({
  CONVERSATION_LOGGER: {
    upsert: (...args: Parameters<ConversationLogger['upsert']>): Promise<void> => fixture.logger!.upsert(...args)
  },
  POST_TURN_MAINTENANCE_QUEUE: { enqueue: vi.fn() }
}))
vi.mock('@/core/profile-runtime/initialize-profile-runtime', () => ({
  ensureActiveProfileRuntime: vi.fn(async () => undefined)
}))
vi.mock('@/core/profile-runtime/profile-paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/profile-runtime/profile-paths')>()
  const { getActiveProfileName: readProfile } = await import('@/core/profile-runtime/profile-context')
  const paths = await import('node:path')

  return {
    ...actual,
    getProfilePaths: (): ProfilePaths => {
      if (!fixture.root) {
        return actual.getProfilePaths()
      }
      const profile = readProfile()
      const root = paths.join(fixture.root, profile)

      return { ...actual.getProfilePaths(profile), root, sessions: paths.join(root, 'sessions') }
    }
  }
})
vi.mock('@/core/llm-manager/llm-duties/react-llm-duty', () => ({
  ReActLLMDuty: class {
    public constructor(private readonly params: ReactLLMDutyParams) {}

    public async init(): Promise<void> {}

    public async execute(): Promise<unknown> {
      const session = CONVERSATION_SESSION_MANAGER.getCurrentSessionId()
      const turn = CONVERSATION_SESSION_MANAGER.openAgentTurn(session)
      const query = String(this.params.input)
      const trace = {
        id: this.params.responseId!, planSteps: [], toolCalls: [],
        reasoning: [{ id: `${query}:thought`, text: 'Public reasoning', phase: 'agent', startedAt: Date.now() }]
      }
      await fixture.logger!.upsert({
        who: 'leon', messageId: trace.id, message: '', isAddedToHistory: false, agentResponseTrace: trace
      }, { sessionId: session, activity: true })
      this.params.onTextStream?.('reasoning', { token: 'Public reasoning', generationId: `${query}:thought` })
      try {
        await new Promise<void>((resolve, reject) => {
          const signal = this.params.signal!
          const abort = (): void => reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
          fixture.executions.push({ profile: getActiveProfileName(), session, query,
            target: CONFIG_STATE.getModelState().getAgentTarget().label, release: () => {
            signal.removeEventListener('abort', abort)
            resolve()
          } })
          if (signal.aborted) {
            abort()
          }
        })
        this.params.onTextStream?.('answer', { token: `Done: ${query}`, generationId: query })

        return { output: `Done: ${query}`, data: {
          agentResponseTrace: trace, llmMetrics: { durationMs: 250 }, finalIntent: 'answer'
        } }
      } finally {
        turn.close()
      }
    }
  }
}))

describe('web conversation runtime', () => {
  let profile = ''
  let app = Fastify()

  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown): ReturnType<typeof app.inject> =>
    app.inject({ method, url, headers: { 'x-test-profile': profile }, ...(payload ? { payload } : {}) })

  beforeEach(async () => {
    fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-web-sessions-'))
    profile = randomUUID()
    fixture.executions.length = 0
    fixture.logger = new ConversationLogger({
      loggerName: 'Conversation integration', fileName: 'conversation_log.json',
      nbOfLogsToLoad: 256, nbOfLogsToKeep: 1_024
    })
    app = Fastify()
    app.addHook('onRequest', async (incoming) => {
      enterProfileContext({ profileName: String(incoming.headers['x-test-profile']) })
    })
    await app.register(sessionsPlugin, { apiVersion: 'v1' })
    await app.ready()
  })

  afterEach(async () => {
    for (const execution of fixture.executions) {
      execution.release()
    }
    await runWithProfileContext({ profileName: profile }, async () => {
      for (const session of CONVERSATION_SESSION_MANAGER.listSessions()) {
        await WEB_SESSION_RUNTIME.stop(session.id)
      }
      CONVERSATION_REPOSITORY.close()
    })
    await app.close()
    await fs.rm(fixture.root, { recursive: true, force: true })
  })

  async function create(): Promise<string> {
    const id = randomUUID()
    const response = await request('POST', '/api/v1/sessions?compact=true', { id })
    expect(response.statusCode).toBe(200)
    expect(response.json()).not.toHaveProperty('sessions')

    return id
  }

  it('pages metadata and history without starting a model, and preserves CRUD changes', async () => {
    const first = await create()
    const second = await create()
    await request('PATCH', `/api/v1/sessions/${first}?compact=true`, { title: 'Camera notes', is_pinned: true })
    const page = await request('GET', '/api/v1/sessions/page?limit=1')
    expect(page.json().sessions[0]).toMatchObject({ id: first, title: 'Camera notes', isPinned: true })
    expect(page.json().next_cursor).toBeTypeOf('string')
    const search = await request('GET', '/api/v1/sessions/page?query=camera')
    expect(search.json().sessions.map((session: { id: string }) => session.id)).toEqual([first])
    const detail = await request('GET', `/api/v1/sessions/${second}?limit=1`)
    expect(detail.json().messages).toEqual([])
    expect(detail.json().event_cursor).toBeTypeOf('number')
    expect(fixture.executions).toHaveLength(0)
    await request('DELETE', `/api/v1/sessions/${first}?compact=true`)
    expect((await request('GET', `/api/v1/sessions/${first}`)).statusCode).toBe(404)
  })

  it('pages query text separately from answers and rejects missing sessions and invalid budgets', async () => {
    const id = await create()
    const other = await create()
    await runWithProfileContext({ profileName: profile }, async () => {
      CONVERSATION_REPOSITORY.acceptCommand(id, randomUUID(), 'First query')
      CONVERSATION_REPOSITORY.upsertMessage(id, {
        who: 'leon', message: 'Answer', isAddedToHistory: true
      })
      CONVERSATION_REPOSITORY.acceptCommand(id, randomUUID(), 'Second query\nsecond line')
      CONVERSATION_REPOSITORY.acceptCommand(other, randomUUID(), 'Other session')
    })

    const page = await request('GET', `/api/v1/sessions/${id}/queries?limit=1`)
    expect(page.statusCode).toBe(200)
    expect(page.json().queries).toEqual([{
      messageId: expect.any(String), message: 'Second query\nsecond line'
    }])
    const older = await request('GET', `/api/v1/sessions/${id}/queries?before=${page.json().next_cursor}`)
    expect(older.json().queries.map((query: { message: string }) => query.message)).toEqual(['First query'])
    expect(older.json().next_cursor).toBeNull()
    expect((await request('GET', `/api/v1/sessions/${id}/queries?characters=1`)).json().queries).toEqual([])
    for (const query of ['limit=101', 'before=NaN', 'characters=0', `characters=${Number.MAX_SAFE_INTEGER + 1}`]) {
      expect((await request('GET', `/api/v1/sessions/${id}/queries?${query}`)).statusCode).toBe(400)
    }
    expect((await request('GET', '/api/v1/sessions/missing/queries')).statusCode).toBe(404)
    expect(fixture.executions).toHaveLength(0)
  })

  it('runs different sessions concurrently, deduplicates delivery, and stops only the addressed session', async () => {
    const first = await create()
    const second = await create()
    await request('PATCH', `/api/v1/sessions/${first}/model`, { provider: 'openai', model: 'gpt-6.1-sol' })
    await request('PATCH', `/api/v1/sessions/${second}/model`, { provider: 'openai', model: 'gpt-6' })
    const id = randomUUID()
    expect((await request('POST', `/api/v1/sessions/${first}/messages`, { id, query: 'First' })).statusCode).toBe(202)
    expect((await request('POST', `/api/v1/sessions/${first}/messages`, { id, query: 'First' })).statusCode).toBe(202)
    expect((await request('POST', `/api/v1/sessions/${first}/messages`, { id, query: 'Different' })).statusCode).toBe(409)
    await request('POST', `/api/v1/sessions/${second}/messages`, { id: randomUUID(), query: 'Second' })
    await vi.waitFor(() => expect(fixture.executions).toHaveLength(2))
    expect(fixture.executions.find((execution) => execution.session === first)?.target).toBe('openai/gpt-6.1-sol')
    expect(fixture.executions.find((execution) => execution.session === second)?.target).toBe('openai/gpt-6')
    const list = (await request('GET', '/api/v1/sessions/page')).json().sessions as { id: string, status: string }[]
    expect(list.filter((session) => session.status === 'wip')).toHaveLength(2)
    await request('POST', `/api/v1/sessions/${first}/stop`)
    expect((await request('GET', `/api/v1/sessions/${first}`)).json().is_running).toBe(false)
    expect((await request('GET', `/api/v1/sessions/${second}`)).json().is_running).toBe(true)
    fixture.executions.find((execution) => execution.session === second)!.release()
    await vi.waitFor(async () => {
      const result = (await request('GET', `/api/v1/sessions/${second}`)).json()
      expect(result.is_running).toBe(false)
      expect(result.messages.filter((message: { who: string }) => message.who === 'leon'))
        .toEqual([expect.objectContaining({ message: 'Done: Second' })])
    })
    const history = (await request('GET', `/api/v1/sessions/${first}`)).json()
    expect(history.messages.filter((message: { who: string }) => message.who === 'owner')).toHaveLength(1)
    expect(history.messages.some((message: { message: string }) => message.message.includes('Second'))).toBe(false)
    expect(vi.mocked(POST_TURN_MAINTENANCE_QUEUE.enqueue).mock.calls.map(([label]) => label)).toEqual([
      'session title generation', 'turn memory observation', 'react self-model reflection', 'memory extraction'
    ])
  })

  it('validates model capabilities and preserves settings per session', async () => {
    const id = await create()
    const catalog = (await request('GET', '/api/v1/sessions/models')).json()
    const provider = catalog.providers.find((item: { id: string }) => item.id === 'openai')
    const model = provider.models[0]
    const response = await request('PATCH', `/api/v1/sessions/${id}/model`, {
      provider: provider.id, model: model.model, reasoning: 'high', speed: 'fast'
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().selection.settings).toEqual({ reasoning: 'high', speed: 'fast' })
    const other = await create()
    expect((await request('GET', `/api/v1/sessions/${other}`)).json().session.modelSettings).toBeUndefined()
    const unsupported = catalog.providers.find((item: { models: { speed: string[] }[] }) =>
      item.models.some((candidate) => !candidate.speed.includes('fast')))
    const unsupportedModel = unsupported.models.find((item: { speed: string[] }) => !item.speed.includes('fast'))
    expect((await request('PATCH', `/api/v1/sessions/${id}/model`, {
      provider: unsupported.id, model: unsupportedModel.model, speed: 'fast'
    })).statusCode).toBe(400)
    expect((await request('GET', `/api/v1/sessions/${id}`)).json().selection.settings.speed).toBe('fast')
  })

  it('streams viewed-session details and offscreen status without leaking other answers', async () => {
    const first = await create()
    const second = await create()
    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const controller = new AbortController()
    const response = await fetch(`${address}/api/v1/sessions/events?session_id=${first}&after=0`, {
      headers: { 'x-test-profile': profile }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)])
    })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.getReader()
    const received = (async (): Promise<string> => {
      let text = ''
      while (!text.includes('Done: First')) {
        const chunk = await reader.read()
        if (chunk.done) {
          break
        }
        text += new TextDecoder().decode(chunk.value)
      }

      return text
    })()
    try {
      await request('POST', `/api/v1/sessions/${first}/messages`, { id: randomUUID(), query: 'First' })
      await request('POST', `/api/v1/sessions/${second}/messages`, { id: randomUUID(), query: 'Second' })
      await vi.waitFor(() => expect(fixture.executions).toHaveLength(2))
      fixture.executions.find((execution) => execution.session === second)!.release()
      await vi.waitFor(async () => expect((await request('GET', `/api/v1/sessions/${second}`)).json().is_running).toBe(false))
      fixture.executions.find((execution) => execution.session === first)!.release()
      const text = await received
      expect(text).toContain('Public reasoning')
      expect(text).toContain(second)
      expect(text).not.toContain('Done: Second')
    } finally {
      controller.abort()
      await reader.cancel().catch(() => undefined)
    }
  })

  it('captures a model/settings snapshot before work is queued', async () => {
    await runWithProfileContext({ profileName: profile }, async () => {
      const id = CONVERSATION_SESSION_MANAGER.createSession().id
      const provider = 'openai'
      const model = 'gpt-6.1-sol'
      await CONVERSATION_SESSION_MANAGER.setSessionModelFromProvider(id, provider, model)
      CONVERSATION_SESSION_MANAGER.updateSession(id, {
        modelSettings: { [`${provider}/${model}`]: { reasoning: 'high', speed: 'fast' } }
      })
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const operation = CONVERSATION_SESSION_MANAGER.runWithSession(id, async () => {
        await gate
        const target = CONFIG_STATE.getModelState().getAgentTarget()
        expect(target.model).toBe(model)
        expect(CONFIG_STATE.getModelSettingsState().getSettings(target)).toEqual({ reasoning: 'high', speed: 'fast' })
      })
      CONVERSATION_SESSION_MANAGER.updateSession(id, { modelTarget: 'openai/gpt-6', modelSettings: {} })
      release()
      await operation
    })
  })

  it('keeps optimistic and streamed feed identity stable across acknowledgements and retries', () => {
    const messages: ConversationRecord[] = [
      { who: 'owner', messageId: 'request', message: 'Hello', sentAt: 10, isAddedToHistory: true },
      { who: 'leon', messageId: 'request:leon', message: '', sentAt: 10, isAddedToHistory: false }
    ]
    const event: ConversationEvent = {
      sequence: 1, type: 'owner_message', session_id: 'session', turn_id: 'request', response_id: null,
      created_at: 20, data: { message: { ...messages[0], sentAt: 20 } }
    }
    const acknowledged = applyConversationEvent(messages, event).sort((left, right) => left.sentAt - right.sentAt)
    expect(acknowledged.map((record) => record.who)).toEqual(['owner', 'leon'])
    const ownerEntry = toFeedEntry(acknowledged[0]!, true)
    const streamed = applyConversationEvent(acknowledged, {
      ...event, sequence: 2, type: 'text_stream', response_id: 'request:leon', data: { kind: 'answer', token: 'Hello!', generationId: 'draft' }
    })
    expect(toFeedEntry(streamed[0]!, true)).toBe(ownerEntry)
    const final = applyConversationEvent(streamed, {
      ...event, sequence: 3, type: 'final_answer', response_id: 'request:leon', data: { content: 'Accepted answer', artifacts: [] }
    })
    const lateReset = applyConversationEvent(final, {
      ...event, sequence: 4, type: 'text_stream', response_id: 'request:leon', data: { kind: 'answer', token: '', reset: true, generationId: 'draft' }
    })
    expect(lateReset).toBe(final)
    expect(lateReset.at(-1)?.message).toBe('Accepted answer')
  })

  it('does not start queued background work after the owning session is deleted', async () => {
    await runWithProfileContext({ profileName: profile }, async () => {
      const session = CONVERSATION_SESSION_MANAGER.createSession()
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const first = CONVERSATION_SESSION_MANAGER.runWithSession(session.id, () => gate)
      const queued = vi.fn()
      const second = CONVERSATION_SESSION_MANAGER.runWithSession(session.id, queued)
      const rejected = expect(second).rejects.toThrow('does not exist')
      CONVERSATION_SESSION_MANAGER.deleteSession(session.id)
      release()
      await first.catch(() => undefined)
      await rejected
      expect(queued).not.toHaveBeenCalled()
      expect(CONVERSATION_REPOSITORY.readSession(session.id)).toBeNull()
    })
  })
})
