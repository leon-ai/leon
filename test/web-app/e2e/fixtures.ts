import { test as base, expect, type Locator, type Response, type Route } from '@playwright/test'

import type { ConversationPage, ConversationRecord, ConversationTool, ModelCatalog, ModelSelection, ConversationNotification } from '../../../apps/web/src/data/conversation'
import { getToolOutputFormat, getToolResultData, toToolContent, toToolDisplayContent, toToolInput } from '../../../apps/web/src/utils/tool-content'
import path from 'node:path'
import { hasToolChanges } from '../../../apps/web/src/utils/tool-changes'
import type { Artifact } from '../../../server/src/core/artifacts/artifact-types'
import type { ToolCallContents } from '../../../server/src/core/session-manager/tool-content-contract'
import type { ConversationSession } from '../../../apps/web/src/data/sessions'
import type { Workspace, WorkspaceSummary } from '../../../bridges/runtime/contracts/workspace'
import type { AmbientConditions } from '../../../apps/web/src/data/ambient-conditions'

const SESSION_COUNT = 3
const HISTORY_TURNS = 240
const PAGE_SIZE = 40

export const SESSION_ID = '00000000-0000-4000-8000-000000000000'
export const OTHER_SESSION_ID = '00000000-0000-4000-8000-000000000001'
export const SESSION_URL = `session/${SESSION_ID}`
export const LATEST_ANSWER = `Saved answer ${HISTORY_TURNS - 1}`

/**
 * Lets finite entrance/disclosure motion settle before the next user action,
 * without waiting for ongoing activity waves or other infinite animations.
 */
export async function finishFiniteAnimations(target: Locator): Promise<void> {
  await target.evaluate(async (element) => {
    await Promise.allSettled(element.getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished))
  })
}

/**
 * Keeps controlled API fixtures aligned with the invocation-content contract.
 */
export function toolContentsFixture(tool: ConversationTool, complete = false): ToolCallContents {
  const output = tool.output ?? tool.commandOutput ?? tool.errorMessage ?? ''
  const result = getToolResultData(tool.output)
  const format = getToolOutputFormat(tool.output)
  const document = toToolDisplayContent(tool.output, complete)
  const fileContent = result && typeof result['path'] === 'string' && typeof result['content'] === 'string' && typeof result['contentHash'] === 'string'
    ? { ...toToolContent(result['content'], complete)!, language: path.extname(result['path']).slice(1) || 'text' } : undefined

  return {
    input: toToolInput(tool.input ?? null, complete)!,
    output: toToolContent(output, complete)!,
    ...(tool.commandOutput === undefined ? {} : { commandOutput: toToolContent(tool.commandOutput, complete, format !== 'markdown', format)! }),
    hasChanges: hasToolChanges(tool.output),
    diffTruncated: Boolean(result?.['diffTruncated']),
    ...(fileContent || document ? { displayOutput: fileContent ?? document! } : {})
  }
}

interface UIFixture {
  uploads: Artifact[]
  models: ModelCatalog
  sessions: ConversationSession[]
  workspaces: Workspace[]
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
    const sessions: ConversationSession[] = Array.from({ length: SESSION_COUNT }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Test session ${index}`, isTitleGenerated: false, isPinned: false,
      status: 'idle' as ConversationSession['status'], createdAt: index, updatedAt: index,
      lastMessageAt: null, messageCount: 0, modelTarget: null
    }))
    const history = new Map<string, ConversationRecord[]>(sessions.map((session) => [session.id, []]))
    const modelSelections = new Map<string, ModelSelection>()
    const uploads = new Map<string, { attachment: Artifact, buffer: Buffer }>()
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
      models: structuredClone(catalog),
      uploads: [],
      sessions, workspaces: [], history, historyRequests: [], requests: [], completedRequests: [],
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
      if (parts[2] === 'workspaces') {
        const summarize = (workspace: Workspace): WorkspaceSummary => {
          const children = sessions.filter((session) => session.workspaceId === workspace.id)

          return { ...workspace, isExplicitlyPinned: workspace.isPinned === true,
            isPinned: workspace.isPinned === true || children.some((session) => session.isPinned), sessionCount: children.length,
            runningSessionCount: children.filter((session) => session.status === 'wip').length,
            lastActivityAt: Math.max(workspace.createdAt, ...children.map((session) => session.lastMessageAt ?? session.createdAt)) }
        }
        if (request.method() === 'GET') {
          await json(route, parts[3] === 'recents' ? {
            items: [...ui.workspaces.map((workspace) => ({ kind: 'workspace', value: summarize(workspace) })),
              ...sessions.filter((session) => !session.workspaceId).map((session) => ({ kind: 'session', value: session }))],
            next_cursor: null
          } : { workspaces: ui.workspaces.map(summarize) })
        } else if (request.method() === 'DELETE') {
          ui.workspaces = ui.workspaces.filter((workspace) => workspace.id !== parts[3])
          for (const session of sessions) {
            if (session.workspaceId === parts[3]) {
              delete session.workspaceId
            }
          }
          await json(route, { success: true })
        } else if (request.method() === 'PATCH') {
          const workspace = ui.workspaces.find((item) => item.id === parts[3])!
          workspace.isPinned = (request.postDataJSON() as { is_pinned: boolean }).is_pinned
          await json(route, { workspace })
        } else {
          const input = request.postDataJSON() as Omit<Workspace, 'color'> & { color?: Workspace['color'] }
          const existing = ui.workspaces.find((workspace) => workspace.id === parts[3])
          const workspace = { color: 'default' as const, ...existing, ...input,
            id: existing?.id ?? crypto.randomUUID(), createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() }
          ui.workspaces = [...ui.workspaces.filter((item) => item.id !== workspace.id), workspace]
          await json(route, { workspace })
        }
        return
      }
      if (parts.at(-1) === 'models') {
        await json(route, ui.models)
        return
      }
      if (parts[2] === 'artifacts' && parts[4]) {
        const upload = uploads.get(parts[4])
        if (upload) {
          await route.fulfill({ contentType: upload.attachment.mime_type, body: upload.buffer })
          return
        }
      }
      if (parts[2] === 'sessions' && parts.length === 3 && request.method() === 'POST') {
        const input = request.postDataJSON() as { id: string, workspace_id?: string }
        let created = sessions.find((candidate) => candidate.id === input.id)
        if (!created) {
          created = { ...sessions[0]!, id: input.id, title: 'New session', messageCount: 0 }
          delete created.workspaceId
          if (input.workspace_id) {
            created.workspaceId = input.workspace_id
          }
          sessions.push(created)
          history.set(input.id, [])
        }
        await json(route, { session: created })
        return
      }
      if (parts.at(-1) === 'page') {
        const query = url.searchParams.get('query')?.toLowerCase() ?? ''
        await json(route, { sessions: sessions.filter((session) => session.title.toLowerCase().includes(query)
          && (!url.searchParams.has('workspace_id') || session.workspaceId === url.searchParams.get('workspace_id'))), next_cursor: null, event_cursor: 0 })
        return
      }
      const session = sessions.find((candidate) => candidate.id === parts[3])
      if (session && request.method() === 'POST' && parts.at(-1) === 'attachments') {
        const buffer = request.postDataBuffer()!
        const id = url.searchParams.get('upload_id') ?? crypto.randomUUID()
        const existing = uploads.get(id)
        if (existing) {
          await json(route, { attachment: existing.attachment }, 201)
          return
        }
        const attachment: Artifact = {
          id, session_id: session.id, filename: url.searchParams.get('filename')!,
          mime_type: url.searchParams.get('media_type')!, size_bytes: buffer.length,
          created_at: Date.now(), source: 'owner-attachment', url: `/api/v1/artifacts/${session.id}/${id}`
        }
        ui.uploads.push(attachment)
        uploads.set(id, { attachment, buffer })
        await json(route, { attachment }, 201)
        return
      }
      if (session && request.method() === 'PATCH' && parts[4] === 'model') {
        const input = request.postDataJSON() as {
          provider: string
          model: string
          reasoning: ModelSelection['settings']['reasoning']
          speed: ModelSelection['settings']['speed']
        }
        const target = `${input.provider}/${input.model}`
        const selection: ModelSelection = {
          provider: input.provider, model: input.model, target,
          settings: { reasoning: input.reasoning, speed: input.speed }
        }
        session.modelTarget = target
        modelSelections.set(session.id, selection)
        await json(route, { selection, session })
        return
      }
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
        if (parts[6] === 'tools' && parts[7]) {
          const tool = message?.agentResponseTrace?.toolCalls.find((call) => call.id === decodeURIComponent(parts[7]!))
          await json(route, tool ? toolContentsFixture(tool, url.searchParams.get('complete') === 'true') : { message: 'Tool call not found.' }, tool ? 200 : 404)
          return
        }
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
          session, messages: records.slice(start, end).map((record) => ({ ...record,
            ...(record.agentResponseTrace ? { agentResponseTrace: { ...record.agentResponseTrace,
              toolCalls: record.agentResponseTrace.toolCalls.map((call) => {
                const metadata = { ...call }
                delete metadata.input
                delete metadata.output
                delete metadata.commandOutput

                return metadata
              })
            } } : {})
          })), next_cursor: start > 0 ? String(start) : null,
          newer_cursor: end < records.length ? String(end) : null, event_cursor: 0,
          is_running: session.status === 'wip', command: null,
          selection: modelSelections.get(session.id) ?? ui.models.selection
        }
        await json(route, data)
        return
      }
      if (session && request.method() === 'POST' && parts.at(-1) === 'messages') {
        const input = request.postDataJSON() as { id: string, query: string, attachments?: string[] }
        const records = history.get(session.id)!
        if (!records.some((record) => record.messageId === input.id)) {
          records.push({ who: 'owner', messageId: input.id, message: input.query, sentAt: Date.now(), isAddedToHistory: true,
            ...(input.attachments?.length ? { artifacts: input.attachments.map((id) => uploads.get(id)!.attachment) } : {}) }, {
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
      // Context disposal cancels remaining streaming requests. Teardown must not
      // wait for a live or already-cancelled route handler to receive a response.
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    }
  }
})

export { expect }
