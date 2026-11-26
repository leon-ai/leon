import contract from '../.generated/runtime/bootstrap-contract.mjs'
import { DESKTOP_CORE_PROTOCOL_VERSION } from '../../../bridges/runtime/contracts/distribution.js'
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

export const TOKEN = 'desktop:fixture-token'
export const OAUTH_PROVIDERS = { 'fixture.account': 'Example account', 'mcp.fixture': 'Example workspace' }
const PROFILE_COOKIE = 'leon_profile_token'
const PROFILE = 'Desktop fixture'
const ARTIFACT = Buffer.from('A disposable Leon artifact.\n')
const SETTINGS = { reasoning: 'auto', speed: 'auto' }
const VISUAL = { root: 'check', elements: { check: { type: 'Generated', props: {
  title: 'Desktop sandbox check', height: 180, fallback: 'A local sandbox interaction check.',
  html: '<button type="button">Check interaction</button>',
  javascript: `const button = document.querySelector('button');
button.addEventListener('click', () => window.parent.postMessage({type:'desktop-sandbox-check', node:typeof require}, '*'));
window.addEventListener('message', (event) => {
  if (event.source === window.parent && event.data === 'desktop-sandbox-check') {
    button.click();
  }
});`
} } } }
const selection = () => ({ provider: 'fixture', model: 'local', target: 'fixture/local', settings: SETTINGS })
const session = (id, title) => ({ id, title, isTitleGenerated: false, isPinned: false,
  status: 'idle', createdAt: Date.now(), updatedAt: Date.now(), lastMessageAt: null, messageCount: 0, modelTarget: null })

/**
 * Supplies only the API data needed to exercise native host boundaries; it never
 * reads owner profiles, uses a provider, or duplicates the browser test suite.
 */
export async function createFixture({ requireLogin = false, historyTurns = 0, streamTokens, streamDelay = 25,
  visual = false, connections = false, devices = false } = {}) {
  const sessions = new Map([['welcome', session('welcome', 'A space for your ideas')]])
  const messages = new Map([['welcome', Array.from({ length: historyTurns }, (_, index) => [
    { messageId: `owner-${index}`, who: 'owner', message: `Archived question ${index}`, sentAt: index * 1_000, isAddedToHistory: true },
    { messageId: `leon-${index}`, who: 'leon', message: `Archived answer ${index}. ` + 'A bounded history preview. '.repeat(12), sentAt: index * 1_000 + 500, isAddedToHistory: true }
  ]).flat()]])
  if (connections) {
    for (const [provider, name] of Object.entries(OAUTH_PROVIDERS)) {
      messages.get('welcome').push({ who: 'owner', messageId: provider + '-request',
        message: `Connect my ${name.toLowerCase()}.`, sentAt: Date.now(), isAddedToHistory: true })
      messages.get('welcome').push({ who: 'leon', messageId: provider, message: '', sentAt: Date.now(),
        isAddedToHistory: false, widget: { widget: 'ConnectionWidget', connection: { provider, name } } })
    }
  }
  sessions.get('welcome').messageCount = messages.get('welcome').length
  const uploads = []
  const ownerCommands = []
  const streams = new Set()
  const events = []
  const jobs = new Set()
  const oauthAttempts = new Map()
  const accounts = new Set()
  const grants = new Map()
  const deviceTurns = []
  const commands = new Map()
  let sequence = 0
  const json = (response, body, status = 200, headers = {}) => {
    const bytes = Buffer.from(JSON.stringify(body))
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length, ...headers }).end(bytes)
  }
  const send = (sessionId, responseId, type, data) => {
    const event = { type, data, sequence: ++sequence, session_id: sessionId, response_id: responseId, created_at: Date.now() }
    events.push(event)
    for (const stream of streams) {
      stream.response.write(`id: ${event.sequence}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`)
    }
  }
  const body = async (request) => {
    const chunks = []
    let bytes = 0
    for await (const chunk of request) {
      bytes += chunk.length
      if (bytes > 1_024 * 1_024) {
        throw new Error('Fixture control body exceeds its bound')
      }
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  }
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, 'http://127.0.0.1')
      const route = url.pathname.slice('/api/v1/'.length)
      const authenticated = !requireLogin || request.headers.cookie?.includes(PROFILE_COOKIE + '=connected')
      if (url.pathname === '/fixture-oauth/authorize') {
        const callback = new URL('/fixture-oauth/callback', `http://127.0.0.1:${server.address().port}`)
        callback.search = url.search
        const accept = new URL(callback)
        accept.searchParams.set('accept', 'yes')
        response.writeHead(200, { 'content-type': 'text/html', 'cross-origin-opener-policy': 'same-origin' })
          .end(`<a href="${accept.href.replaceAll('&', '&amp;')}">Authorize test account</a><a href="${callback.href}">Deny access</a>`)
        return
      }
      if (url.pathname === '/fixture-oauth/callback') {
        const state = url.searchParams.get('state')
        const attempt = oauthAttempts.get(state)
        if (!attempt) {
          response.writeHead(400).end()
          return
        }
        oauthAttempts.delete(state)
        const accepted = url.searchParams.get('accept') === 'yes'
        if (accepted) {
          accounts.add(attempt.provider)
        }
        attempt.returnURL.searchParams.set('provider', attempt.provider)
        attempt.returnURL.searchParams.set('connection_result', accepted ? 'connected' : 'failed')
        response.writeHead(303, { location: attempt.returnURL.href }).end()
        return
      }
      if (devices && url.pathname === '/fixture-device/ready' && request.method === 'POST') {
        const grant = grants.get((await body(request)).credential)
        if (grant) {
          grant.online = true
        }
        response.writeHead(grant ? 204 : 403).end()
        return
      }
      if (route === 'profile-auth') {
        if (request.method === 'POST') {
          if ((await body(request)).token !== TOKEN) {
            json(response, { message: 'Invalid fixture credential' }, 401)
            return
          }
          json(response, { authenticated: true, profile_name: PROFILE }, 200,
            { 'set-cookie': PROFILE_COOKIE + '=connected; Path=/; HttpOnly; SameSite=Strict' })
        } else {
          json(response, { authenticated: Boolean(authenticated), profile_name: authenticated ? PROFILE : null,
            version: contract.sourceVersion, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION })
        }
        return
      }
      if (!authenticated) {
        json(response, { message: 'Sign in to the fixture' }, 401)
        return
      }
      const [resource, provider, action] = route.split('/')
      if (connections && resource === 'connections' && action === 'setup' && provider in OAUTH_PROVIDERS) {
        const input = await body(request)
        const connected = accounts.has(provider)
        const title = OAUTH_PROVIDERS[provider]
        const view = {
          title, state: { method: 'oauth', step: connected ? 'connected' : 'choice' },
          fields: [], links: [], actions: connected ? [] : [{ id: 'connect', label: `Connect ${title}` }],
          ...(input.authorization_failed && !connected ? { notice: 'Sign-in was cancelled. You can try again.' } : {})
        }
        if (input.action === 'connect') {
          const state = randomUUID()
          const authorization = new URL('/fixture-oauth/authorize', `http://localhost:${server.address().port}`)
          authorization.searchParams.set('state', state)
          oauthAttempts.set(state, { provider, returnURL: new URL(input.return_url) })
          json(response, { view, authorization_url: authorization.href })
        } else {
          json(response, { view })
        }
        return
      }
      if (devices && resource === 'devices') {
        if (request.method === 'POST') {
          const { tools } = await body(request)
          const id = 'desktop-' + randomUUID()
          const credential = randomUUID()
          grants.set(credential, { id, tools, online: false })
          json(response, { id, credential }, 201)
        } else if (request.method === 'DELETE') {
          for (const [credential, grant] of grants) {
            if (grant.id === provider) {
              grants.delete(credential)
            }
          }
          response.writeHead(204).end()
        } else {
          json(response, { devices: [...grants.values()] })
        }
        return
      }
      if (route.endsWith('/attachments') && request.method === 'POST') {
        const upload = { bytes: 0, complete: false, digest: null }
        uploads.push(upload)
        const digest = createHash('sha256')
        try {
          for await (const chunk of request) {
            upload.bytes += chunk.length
            digest.update(chunk)
            await delay(3)
          }
          upload.complete = true
          upload.digest = digest.digest('hex')
          const id = url.searchParams.get('upload_id') ?? randomUUID()
          const sessionId = route.split('/')[1]
          json(response, { attachment: { id, session_id: sessionId, filename: url.searchParams.get('filename'),
            mime_type: url.searchParams.get('media_type'), size_bytes: upload.bytes, created_at: Date.now(),
            source: 'owner-attachment', url: `/api/v1/artifacts/${sessionId}/${id}` } })
        } catch {
          // Cancellation must leave an incomplete receipt for the driver.
        }
        return
      }
      if (route.startsWith('artifacts/')) {
        const range = request.headers.range?.slice('bytes='.length).split('-')
        const start = Number(range?.[0] ?? 0)
        const end = Math.min(Number(range?.[1] || ARTIFACT.length - 1), ARTIFACT.length - 1)
        response.writeHead(range ? 206 : 200, { 'content-type': 'text/plain',
          'content-security-policy': 'sandbox; default-src \'none\'', 'accept-ranges': 'bytes',
          'content-disposition': `${url.searchParams.has('inline') ? 'inline' : 'attachment'}; filename="fixture-note.txt"`,
          'content-length': end - start + 1, ...(range ? { 'content-range': `bytes ${start}-${end}/${ARTIFACT.length}` } : {}) }).end(ARTIFACT.subarray(start, end + 1))
        return
      }
      if (route === 'sessions/page') {
        json(response, { sessions: [...sessions.values()], next_cursor: null, event_cursor: sequence })
      } else if (route === 'workspaces') {
        json(response, { workspaces: [] })
      } else if (route === 'tools/catalog') {
        json(response, { tools: [] })
      } else if (route === 'ambient') {
        json(response, { success: true, ambient: { mood: 'default', season: 'winter', solarPhase: 'night', timeZone: 'UTC', weather: null } })
      } else if (route === 'sessions/models') {
        json(response, { providers: [{ id: 'fixture', label: 'Local fixture', models: [{ model: 'local', label: 'Local fixture',
          reasoning: ['auto'], speed: ['auto'], recommended: true }] }], selection: selection(), defaults: { 'fixture/local': SETTINGS } })
      } else if (route === 'sessions/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
        response.flushHeaders()
        const after = Number(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0)
        for (const event of events.filter((event) => event.sequence > after)) {
          response.write(`id: ${event.sequence}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`)
        }
        const stream = { response }
        streams.add(stream)
        request.once('close', () => streams.delete(stream))
      } else if (route === 'sessions' && request.method === 'POST') {
        const value = session((await body(request)).id ?? randomUUID(), 'A fresh conversation')
        sessions.set(value.id, value)
        messages.set(value.id, [])
        json(response, { session: value })
      } else if (route.startsWith('sessions/')) {
        const [, id, action, messageId, submission] = route.split('/')
        const value = sessions.get(id)
        if (!value) {
          json(response, { message: 'Unknown fixture session' }, 404)
        } else if (action === 'queries') {
          json(response, { queries: [], next_cursor: null })
        } else if (action === 'stop' && request.method === 'POST') {
          const active = commands.get(id)
          if (active) {
            active.controller.abort()
            value.status = 'idle'
            const message = 'Stopped by you.'
            messages.get(id).push({ who: 'leon', messageId: active.responseId, message,
              sentAt: Date.now(), isAddedToHistory: true })
            send(id, active.responseId, 'error', { message, answer_parts: [] })
            send(id, active.responseId, 'session_changed', { is_running: false })
            send(id, active.responseId, 'turn_status', { status: 'stopped' })
          }
          json(response, { success: true })
        } else if (action === 'messages' && request.method === 'POST') {
          const command = await body(request)
          ownerCommands.push({
            kind: messageId && submission === 'ui' ? 'ui' : 'message',
            clientType: request.headers['x-leon-client-type'],
            clientOS: request.headers['x-leon-client-os']
          })
          if (messageId && submission === 'ui') {
            json(response, { command: { id: command.id, status: 'accepted' }, answerParts: [] }, 202)
            return
          }
          const responseId = `${command.id}:leon`
          const record = { who: 'owner', messageId: command.id, message: command.query, sentAt: Date.now(), isAddedToHistory: true }
          messages.get(id).push(record)
          value.status = 'wip'
          send(id, responseId, 'owner_message', { message: record })
          send(id, responseId, 'turn_status', { status: 'accepted' })
          const selected = grants.get(request.headers['x-leon-device-credential'])
          if (devices) {
            deviceTurns.push(selected?.online ? selected.id : null)
          }
          if (devices && !selected?.online && command.query === 'Use Computer Use to inspect this desktop.') {
            const widget = { widget: 'ComputerUsePermission', responseId, fallbackText: 'I need permission to use this computer.' }
            const widgetId = `computer-use-permission-${responseId}`
            messages.get(id).push({ who: 'leon', messageId: widgetId, message: widget.fallbackText,
              sentAt: Date.now(), isAddedToHistory: false, widget })
            send(id, widgetId, 'widget', { widget })
          }
          const tokens = streamTokens ?? ['Hello from the fixture.']
          const controller = new AbortController()
          commands.set(id, { responseId, controller })
          const job = (async () => {
            for (const token of tokens) {
              await delay(streamDelay, undefined, { signal: controller.signal })
              send(id, responseId, 'text_stream', { kind: 'answer', generationId: responseId, token })
            }
            const answer = tokens.join('')
            const parts = visual ? [{ id: 'sandbox-check', kind: 'ui', surface: {
              id: 'sandbox-check', revision: 1, status: 'ready', purpose: 'clarification',
              spec: VISUAL, receipts: {}, ownerMessageId: command.id
            } }] : []
            messages.get(id).push({ who: 'leon', messageId: responseId, message: answer, answerParts: parts, sentAt: Date.now(), isAddedToHistory: true })
            value.status = 'idle'
            send(id, responseId, 'final_answer', { content: answer, artifacts: [], answer_parts: parts })
            send(id, responseId, 'session_changed', { is_running: false })
            send(id, responseId, 'turn_status', { status: 'completed' })
          })().catch((error) => {
            if (!controller.signal.aborted) {
              throw error
            }
          }).finally(() => {
            if (commands.get(id)?.controller === controller) {
              commands.delete(id)
            }
          })
          jobs.add(job)
          void job.finally(() => jobs.delete(job))
          json(response, { command: { id: command.id, status: 'accepted' } }, 202)
        } else {
          const records = messages.get(id)
          const end = Number(url.searchParams.get('before') ?? records.length)
          const begin = Math.max(0, end - Number(url.searchParams.get('limit') ?? 40))
          json(response, { session: value, messages: records.slice(begin, end), next_cursor: begin ? String(begin) : null,
            event_cursor: sequence, is_running: value.status === 'wip', newer_cursor: end < records.length ? String(end) : null,
            command: null, selection: selection() })
        }
      } else {
        json(response, { message: 'Unknown fixture route' }, 404)
      }
    })().catch((error) => {
      if (!response.headersSent) {
        json(response, { message: error.message }, 500)
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, uploads, ownerCommands, grants, deviceTurns,
    async close() {
      for (const { controller } of commands.values()) {
        controller.abort()
      }
      await Promise.allSettled(jobs)
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
