import contract from '../.generated/runtime/bootstrap-contract.mjs'
import { DESKTOP_CORE_PROTOCOL_VERSION } from '../../../bridges/runtime/contracts/distribution.js'
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const TOKEN = 'desktop:fixture-token'
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
export async function createFixture({ requireLogin = false, historyTurns = 0, streamTokens, streamDelay = 25, visual = false } = {}) {
  const sessions = new Map([['welcome', session('welcome', 'A space for your ideas')]])
  const messages = new Map([['welcome', Array.from({ length: historyTurns }, (_, index) => [
    { messageId: `owner-${index}`, who: 'owner', message: `Archived question ${index}`, sentAt: index * 1_000, isAddedToHistory: true },
    { messageId: `leon-${index}`, who: 'leon', message: `Archived answer ${index}. ` + 'A bounded history preview. '.repeat(12), sentAt: index * 1_000 + 500, isAddedToHistory: true }
  ]).flat()]])
  sessions.get('welcome').messageCount = historyTurns * 2
  const uploads = []
  const ownerCommands = []
  const streams = new Set()
  const events = []
  const jobs = new Set()
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
      const authenticated = !requireLogin || request.headers.cookie?.includes('fixture-profile=connected')
      if (route === 'profile-auth') {
        if (request.method === 'POST') {
          if ((await body(request)).token !== TOKEN) {
            json(response, { message: 'Invalid fixture credential' }, 401)
            return
          }
          json(response, { authenticated: true, profile_name: PROFILE }, 200,
            { 'set-cookie': 'fixture-profile=connected; Path=/; HttpOnly; SameSite=Strict' })
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
          const tokens = streamTokens ?? ['Hello from the fixture.']
          const job = (async () => {
            for (const token of tokens) {
              await delay(streamDelay)
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
          })()
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
  return { origin: `http://127.0.0.1:${server.address().port}`, uploads, ownerCommands,
    async close() {
      await Promise.allSettled(jobs)
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
