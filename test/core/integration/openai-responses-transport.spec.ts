import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

import { OpenAIResponsesTransport } from '@/core/llm-manager/llm-providers/openai-responses-transport'
import { runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { runWithConversationSession } from '@/core/session-manager/session-context'

vi.mock('@/config', () => ({ CONFIG_MANAGER: { getConfig: (): object => ({}) } }))

const OUTPUT = [{
  type: 'message', id: 'message', role: 'assistant', status: 'completed',
  content: [{ type: 'output_text', text: 'Ready.', annotations: [] }]
}]
const INPUT = [{ role: 'user', content: 'Hello.' }]

describe('Responses connection lifecycle', () => {
  let server: Server
  let sockets: WebSocketServer
  let transport: OpenAIResponsesTransport
  let url: string

  beforeEach(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(`data: ${JSON.stringify({
        type: 'response.completed', response: { id: 'http', output: OUTPUT }
      })}\n\n`)
    })
    sockets = new WebSocketServer({ noServer: true })
    server.on('upgrade', (request, socket, head) => {
      sockets.handleUpgrade(request, socket, head, (connection) => {
        sockets.emit('connection', connection, request)
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/responses`
    transport = new OpenAIResponsesTransport(url.slice(0, -'/responses'.length))
  })

  afterEach(async () => {
    transport.close()
    for (const socket of sockets.clients) {
      socket.terminate()
    }

    sockets.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  async function request(
    input: unknown[] = INPUT,
    options: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<string> {
    const response = await transport.fetch(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer fixture',
        'chatgpt-account-id': 'workspace',
        originator: 'leon'
      },
      body: JSON.stringify({
        model: 'fixture', stream: true, store: false, input, ...options
      }),
      ...(signal ? { signal } : {})
    })

    return response.text()
  }

  it('preserves authentication and sends only new input on a matching connection', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'unrelated-key')
    vi.stubEnv('OPENAI_ORG_ID', 'unrelated-organization')
    vi.stubEnv('OPENAI_PROJECT_ID', 'unrelated-project')
    const connections: Record<string, unknown>[] = []
    const requests: Record<string, unknown>[] = []
    sockets.on('connection', (socket, handshake) => {
      connections.push({
        authorization: handshake.headers.authorization,
        account: handshake.headers['chatgpt-account-id'],
        originator: handshake.headers['originator'],
        organization: handshake.headers['openai-organization'],
        project: handshake.headers['openai-project']
      })
      socket.on('message', (data) => {
        requests.push(JSON.parse(data.toString()))
        socket.send(JSON.stringify({
          type: 'response.completed',
          response: { id: `response-${requests.length}`, output: OUTPUT }
        }))
      })
    })
    const next = { role: 'user', content: 'Continue.' }

    await request()
    await request([...INPUT, ...OUTPUT, next])
    await request([...INPUT, ...OUTPUT, next], { tools: [] })
    await request([{ role: 'user', content: 'Edited request.' }])

    expect(connections).toEqual([{
      authorization: 'Bearer fixture', account: 'workspace', originator: 'leon',
      organization: undefined, project: undefined
    }])
    expect(requests[1]).toMatchObject({
      previous_response_id: 'response-1', input: [next], store: false
    })
    expect(requests.every((item) => item['stream'] === undefined)).toBe(true)
    expect(requests[2]?.['previous_response_id']).toBeUndefined()
    expect(requests[3]?.['previous_response_id']).toBeUndefined()
  })

  it('isolates connections across profiles and conversations', async () => {
    const requests: Record<string, unknown>[] = []
    let connections = 0
    sockets.on('connection', (socket) => {
      connections += 1
      socket.on('message', (data) => {
        requests.push(JSON.parse(data.toString()))
        socket.send(JSON.stringify({
          type: 'response.completed', response: { id: 'response', output: OUTPUT }
        }))
      })
    })

    for (const [profileName, sessionId] of [
      ['first', 'first'], ['first', 'second'], ['second', 'first']
    ]) {
      await runWithProfileContext({ profileName: profileName! }, () =>
        runWithConversationSession({ sessionId: sessionId! }, () => request())
      )
    }

    expect(connections).toBe(3)
    expect(requests.every((item) => item['previous_response_id'] === undefined)).toBe(true)
  })

  it('cancels a pending response and reconnects with the full transcript', async () => {
    const requests: Record<string, unknown>[] = []
    sockets.on('connection', (socket) => {
      socket.on('message', (data) => {
        requests.push(JSON.parse(data.toString()))
        if (requests.length > 1) {
          socket.send(JSON.stringify({
            type: 'response.completed', response: { id: 'response', output: OUTPUT }
          }))
        }
      })
    })
    const controller = new AbortController()
    const pending = request(INPUT, {}, controller.signal)
    const rejected = expect(pending).rejects.toThrow('Canceled')
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    controller.abort(new Error('Canceled'))
    await rejected
    await request()

    expect(requests[1]?.['input']).toEqual(INPUT)
    expect(requests[1]?.['previous_response_id']).toBeUndefined()
  })

  it('uses HTTP after an unsupported handshake without retrying the handshake', async () => {
    server.removeAllListeners('upgrade')
    let attempts = 0
    server.on('upgrade', (_request, socket) => {
      attempts += 1
      socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n')
    })

    expect(await request()).toContain('response.completed')
    expect(await request()).toContain('response.completed')
    expect(transport.transport).toBe('http')
    expect(attempts).toBe(1)
  })

  it.each([
    { error: { code: 'previous_response_not_found' } },
    { code: 'previous_response_id_not_found' }
  ])('resends the full transcript when the server has expired a continuation: %j', async (error) => {
    const requests: Record<string, unknown>[] = []
    sockets.on('connection', (socket) => {
      socket.on('message', (data) => {
        const body = JSON.parse(data.toString())
        requests.push(body)
        if (body.previous_response_id) {
          socket.send(JSON.stringify({
            type: 'error', ...error
          }))
          return
        }

        socket.send(JSON.stringify({
          type: 'response.completed', response: { id: 'response', output: OUTPUT }
        }))
      })
    })
    const next = [...INPUT, ...OUTPUT, { role: 'user', content: 'Continue.' }]

    await request()
    expect(await request(next)).toContain('response.completed')
    expect(requests).toHaveLength(3)
    expect(requests[1]?.['previous_response_id']).toBe('response')
    expect(requests[2]?.['previous_response_id']).toBeUndefined()
    expect(requests[2]?.['input']).toEqual(next)
  })

  it.each([401, 403])('preserves an HTTP %s authentication rejection', async (status) => {
    server.removeAllListeners('upgrade')
    server.on('upgrade', (_request, socket) => {
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`)
    })

    await expect(request()).rejects.toMatchObject({ statusCode: status })
  })

  it('reports a disconnected generation without replaying it over HTTP', async () => {
    const http = vi.fn()
    server.on('request', http)
    sockets.on('connection', (socket) => {
      socket.on('message', () => {
        socket.send(JSON.stringify({
          type: 'response.output_text.delta', delta: 'Provisional.'
        }), () => socket.close())
      })
    })

    await expect(request()).rejects.toThrow('before terminal completion')
    expect(http).not.toHaveBeenCalled()
  })
})
