import { test as base, expect, type Response, type Route } from '@playwright/test'

import type { ConversationPage, ConversationRecord, ModelCatalog, ConversationNotification } from '../../../apps/web/src/data/conversation'
import type { ConversationSession } from '../../../apps/web/src/data/sessions'
import type { AmbientConditions } from '../../../apps/web/src/data/ambient-conditions'

const SESSION_COUNT = 3
const HISTORY_TURNS = 240
const PAGE_SIZE = 40

export const SESSION_ID = '00000000-0000-4000-8000-000000000000'
export const OTHER_SESSION_ID = '00000000-0000-4000-8000-000000000001'
export const SESSION_URL = `session/${SESSION_ID}`
export const LATEST_ANSWER = `Saved answer ${HISTORY_TURNS - 1}`

interface UIFixture {
  sessions: ConversationSession[]
  history: Map<string, ConversationRecord[]>
  historyRequests: URL[]
  requests: URL[]
  completedRequests: URL[]
  authenticated: boolean
  profile: string
  holdHistory: () => () => void
  holdAuthentication: () => () => void
  failure: { path: string, status: number, message: string } | undefined
  ambient: AmbientConditions
  emit: (events: ConversationNotification[]) => Promise<void>
}

const catalog: ModelCatalog = {
  providers: [{
    id: 'openai', label: 'OpenAI', models: [{
      model: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', recommended: false,
      reasoning: ['auto', 'low', 'medium', 'high'], speed: ['auto', 'normal', 'fast'],
      defaultReasoningLabel: 'High', defaultReasoningEffort: 'high'
    }]
  }],
  selection: {
    provider: 'openai', model: 'gpt-6.1-sol', target: 'openai/gpt-6.1-sol',
    settings: { reasoning: 'high', speed: 'auto' }
  },
  defaults: { 'openai/gpt-6.1-sol': { reasoning: 'high', speed: 'auto' } }
}

/**
 * Exercises the production UI with per-context HTTP data, without paid models
 * or owner profiles. Core's real persistence/runtime integration is tested separately.
 */
export const test = base.extend<{ ui: UIFixture }>({
  ui: async ({ page }, use): Promise<void> => {
    const streamId = crypto.randomUUID()
    const sessions = Array.from({ length: SESSION_COUNT }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Test session ${index}`, isTitleGenerated: false, isPinned: false,
      status: 'idle' as ConversationSession['status'], createdAt: index, updatedAt: index,
      lastMessageAt: null, messageCount: 0, modelTarget: null
    }))
    const history = new Map<string, ConversationRecord[]>(sessions.map((session) => [session.id, []]))
    for (let index = 0; index < HISTORY_TURNS; index++) {
      history.get(SESSION_ID)!.push({
        who: 'owner', messageId: `question-${index}`, message: `Saved question ${index}`,
        sentAt: index * 1_000, isAddedToHistory: true
      }, {
        who: 'leon', messageId: `answer-${index}`, message: `Saved answer ${index}`,
        sentAt: index * 1_000 + 500, isAddedToHistory: true
      })
    }
    const gates: { history: Promise<void> | undefined, auth: Promise<void> | undefined } = {
      history: undefined, auth: undefined
    }
    const releases = new Set<() => void>()
    function holdRequest(key: keyof typeof gates): () => void {
      const gate = Promise.withResolvers<void>()
      gates[key] = gate.promise
      const release = (): void => {
        gates[key] = undefined
        gate.resolve()
        releases.delete(release)
      }
      releases.add(release)

      return release
    }

    const ui: UIFixture = {
      sessions, history, historyRequests: [], requests: [], completedRequests: [],
      authenticated: true, profile: 'ui-tests', failure: undefined,
      ambient: { mood: 'default', season: 'autumn', solarPhase: 'afternoon', timeZone: 'UTC', weather: null },
      holdHistory: (): (() => void) => holdRequest('history'),
      holdAuthentication: (): (() => void) => holdRequest('auth'),
      emit: async (events): Promise<void> => {
        await expect.poll(async () => (await page.request.post(`/__ui/events/${streamId}`, { data: events })).status()).toBe(204)
      }
    }
    // Lifecycle probes can cancel an initial request before a response arrives.
    // Keep completed reads separate from attempts used to inspect cursor ordering.
    const recordResponse = (response: Response): void => {
      const url = new URL(response.url())
      if (url.pathname.startsWith('/api/v1/')) {
        ui.completedRequests.push(url)
      }
    }
    page.on('response', recordResponse)
    const json = async (route: Route, data: unknown, status = 200): Promise<void> => {
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    }

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      ui.requests.push(url)
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.at(-1) === 'events') {
        url.searchParams.set('ui_stream', streamId)
        await route.continue({ url: url.toString() })
        return
      }
      if (ui.failure?.path === url.pathname) {
        await json(route, { message: ui.failure.message }, ui.failure.status)
        return
      }
      if (parts.at(-1) === 'profile-auth') {
        await gates.auth
        if (request.method() === 'POST') {
          const input = request.postDataJSON() as { token: string }
          if (input.token !== 'fixture-token') {
            await json(route, { message: 'Invalid profile token.' }, 401)
            return
          }
          ui.authenticated = true
        }
        await json(route, { authenticated: ui.authenticated, profile_name: ui.authenticated ? ui.profile : null })
        return
      }
      if (parts.at(-1) === 'ambient') {
        await json(route, { success: true, ambient: ui.ambient })
        return
      }
      if (parts.at(-1) === 'models') {
        await json(route, catalog)
        return
      }
      if (parts.at(-1) === 'page') {
        const query = url.searchParams.get('query')?.toLowerCase() ?? ''
        await json(route, { sessions: sessions.filter((session) => session.title.toLowerCase().includes(query)), next_cursor: null, event_cursor: 0 })
        return
      }
      const session = sessions.find((candidate) => candidate.id === parts[3])
      if (session && request.method() === 'GET' && parts[4] === 'queries') {
        const records = history.get(session.id)!
        const before = Number(url.searchParams.get('before') ?? records.length + 1)
        const limit = Number(url.searchParams.get('limit'))
        const budget = Math.min(128 * 1_024, Number(url.searchParams.get('characters')))
        const candidates = records.map((record, index) => ({ record, sequence: index + 1 }))
          .filter(({ record, sequence }) => record.who === 'owner' && record.isAddedToHistory &&
            record.message !== '' && sequence < before).reverse()
        const queries: Pick<ConversationRecord, 'messageId' | 'message'>[] = []
        let characters = 0
        let lastSequence: string | null = null
        let nextCursor: string | null = null
        for (const { record, sequence } of candidates) {
          if (queries.length === limit || characters + record.message.length > budget) {
            nextCursor = lastSequence
            break
          }
          queries.push({ messageId: record.messageId, message: record.message })
          characters += record.message.length
          lastSequence = String(sequence)
        }
        await json(route, { queries, next_cursor: nextCursor })
        return
      }
      if (session && request.method() === 'GET' && parts[4] === 'messages' && parts[5]) {
        const message = history.get(session.id)!.find((record) => record.messageId === decodeURIComponent(parts[5]!))
        await json(route, message ? { message } : { message: 'Message not found.' }, message ? 200 : 404)
        return
      }
      if (session && request.method() === 'GET' && parts.length === 4) {
        ui.historyRequests.push(url)
        await gates.history
        const records = history.get(session.id)!
        const end = Number(url.searchParams.get('before') ?? records.length)
        const start = Math.max(0, end - PAGE_SIZE)
        const data: ConversationPage = {
          session, messages: records.slice(start, end), next_cursor: start > 0 ? String(start) : null,
          newer_cursor: end < records.length ? String(end) : null, event_cursor: 0,
          is_running: session.status === 'wip', command: null, selection: catalog.selection
        }
        await json(route, data)
        return
      }
      if (session && request.method() === 'POST' && parts.at(-1) === 'messages') {
        const input = request.postDataJSON() as { id: string, query: string }
        const records = history.get(session.id)!
        if (!records.some((record) => record.messageId === input.id)) {
          records.push({ who: 'owner', messageId: input.id, message: input.query, sentAt: Date.now(), isAddedToHistory: true }, {
            who: 'leon', messageId: `${input.id}:leon`, message: `Completed ${input.query}`,
            sentAt: Date.now() + 1, isAddedToHistory: true
          })
        }
        await json(route, { command: { id: input.id, status: 'completed' } })
        return
      }
      await json(route, { message: 'Unsupported UI fixture request.' }, 404)
    })

    try {
      await use(ui)
    } finally {
      page.off('response', recordResponse)
      for (const release of releases) {
        release()
      }
      await page.unrouteAll({ behavior: 'wait' })
    }
  }
})

export { expect }
