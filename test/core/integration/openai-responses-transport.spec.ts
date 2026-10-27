import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

import { OpenAIResponsesTransport } from '@/core/llm-manager/llm-providers/openai-responses-transport'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import { runCompletionAttempt } from '@/core/llm-manager/llm-provider/llm-provider-attempt'
import { formatPromptErrorForLog } from '@/core/llm-manager/llm-provider/llm-provider-errors'
import { ProviderRequestActivity } from '@/core/llm-manager/llm-provider/provider-request-activity'
import { LogHelper } from '@/helpers/log-helper'
import type { PreparedCompletionParams } from '@/core/llm-manager/llm-provider/llm-provider-types'
import { LLMDuties, LLMProviders, type CompletionParams } from '@/core/llm-manager/types'
import { runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { runWithConversationSession } from '@/core/session-manager/session-context'

vi.mock('@/config', () => ({ CONFIG_MANAGER: { getConfig: (): object => ({}) } }))
vi.mock('@/core', () => ({ BRAIN: { wernicke: vi.fn() } }))
vi.mock('@/core/config-states/config-state', () => ({ CONFIG_STATE: {} }))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: {
    title: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    timeEnd: vi.fn()
  }
}))

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
    signal?: AbortSignal,
    onStreamEvent?: CompletionParams['onStreamEvent']
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
    }, onStreamEvent)

    return response.text()
  }

  it('rejects oversized UTF-8 messages before upload and accepts a smaller request afterward', async () => {
    const received = vi.fn()
    const http = vi.fn()
    server.on('request', http)
    sockets.on('connection', (socket) => {
      socket.on('message', (data) => {
        received(data.toString())
        socket.send(JSON.stringify({
          type: 'response.completed', response: { id: 'small', output: OUTPUT }
        }))
      })
    })

    await expect(request([{ role: 'user', content: 'é'.repeat(8 * 1_024 * 1_024) }]))
      .rejects.toMatchObject({
        statusCode: 413,
        transportPhase: 'upload',
        requestBytes: expect.any(Number),
        uploadDurationMs: undefined
      })
    expect(received).not.toHaveBeenCalled()
    expect(http).not.toHaveBeenCalled()
    expect(await request()).toContain('small')
    expect(received).toHaveBeenCalledOnce()
  })

  it('reports serialized request bytes and local upload completion without claiming provider acceptance', async () => {
    const events = vi.fn()
    const received: string[] = []
    sockets.on('connection', (socket) => {
      socket.on('message', (data) => {
        received.push(data.toString())
        socket.send(JSON.stringify({
          type: 'response.completed', response: { id: 'uploaded', output: OUTPUT }
        }))
      })
    })

    const response = await transport.fetch(url, {
      method: 'POST',
      body: JSON.stringify({ model: 'fixture', stream: true, input: INPUT })
    }, events)
    await response.text()

    expect(events).toHaveBeenCalledWith({
      type: 'request-uploaded', transport: 'websocket',
      requestBytes: Buffer.byteLength(received[0]!), uploadDurationMs: expect.any(Number)
    })
    expect(events).not.toHaveBeenCalledWith(expect.objectContaining({
      providerEventType: 'response.in_progress'
    }))
  })

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

  it('rotates aged connections and restores the full transcript', async () => {
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const requests: Record<string, unknown>[] = []
    let connections = 0

    sockets.on('connection', (socket) => {
      connections += 1
      socket.on('message', (data) => {
        requests.push(JSON.parse(data.toString()))
        socket.send(JSON.stringify({
          type: 'response.completed',
          response: { id: 'response', output: OUTPUT }
        }))
      })
    })
    const next = [...INPUT, ...OUTPUT, { role: 'user', content: 'Continue.' }]

    await request()
    now += 55 * 60_000
    await request(next)

    expect(connections).toBe(2)
    expect(requests[1]?.['input']).toEqual(next)
    expect(requests[1]?.['previous_response_id']).toBeUndefined()
  })

  it.each([false, true])('bounds reconnection after an explicit connection expiry (rejected again=%s)', async (rejectedAgain) => {
    const requests: Record<string, unknown>[] = []
    let connections = 0
    const error = {
      code: 'websocket_connection_limit_reached',
      message: 'Create a new websocket connection to continue.',
      type: 'invalid_request_error'
    }

    sockets.on('connection', (socket) => {
      connections += 1
      socket.on('message', (data) => {
        requests.push(JSON.parse(data.toString()))

        if (requests.length === 2 || (rejectedAgain && requests.length > 2)) {
          socket.send(JSON.stringify({ type: 'error', status: 400, error }))
          return
        }

        socket.send(JSON.stringify({
          type: 'response.completed',
          response: { id: 'response', output: OUTPUT }
        }))
      })
    })
    const next = [...INPUT, ...OUTPUT, { role: 'user', content: 'Continue.' }]

    await request()

    if (rejectedAgain) {
      await expect(request(next)).rejects.toMatchObject({
        message: error.message,
        code: error.code,
        statusCode: 400
      })
    } else {
      expect(await request(next)).toContain('response.completed')
    }

    expect(connections).toBe(2)
    expect(requests).toHaveLength(3)
    expect(requests[1]?.['previous_response_id']).toBe('response')
    expect(requests[2]?.['previous_response_id']).toBeUndefined()
    expect(requests[2]?.['input']).toEqual(next)
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

  it.each([
    { accepted: false, commentary: false },
    { accepted: true, commentary: false },
    { accepted: true, commentary: true }
  ])('bounds acceptance and preserves silent work after commentary ($accepted, $commentary)', async ({ accepted, commentary }) => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
    const provider = new AISDKRemoteLLMProvider({
      name: 'Fixture',
      providerName: LLMProviders.OpenAI,
      credentials: { api_key: 'fixture' },
      apiKeyEnv: 'LEON_OPENAI_API_KEY',
      model: 'gpt-6.1-sol',
      baseURL: url.slice(0, -'/responses'.length),
      flavor: 'openai-responses'
    })
    const requests: Record<string, unknown>[] = []
    const onAttempt = vi.fn()
    const onStreamEvent = vi.fn()
    const onToken = vi.fn()
    const reportError = vi.fn()
    const closed = vi.fn()
    const ping = vi.fn()
    const response = {
      id: 'response',
      model: 'gpt-6.1-sol',
      created_at: 1,
      status: 'in_progress',
      output: []
    }
    let finish!: () => void

    sockets.on('connection', (socket) => {
      socket.on('close', closed)
      socket.on('ping', ping)
      socket.on('message', (data) => {
        requests.push(JSON.parse(data.toString()))
        const send = (event: Record<string, unknown>): void => {
          socket.send(JSON.stringify(event))
        }
        const complete = (): void => {
          send({ type: 'response.output_item.added', output_index: 0, item: {
            ...OUTPUT[0], content: []
          } })
          send({
            type: 'response.output_text.delta',
            item_id: 'message',
            output_index: 0,
            content_index: 0,
            delta: 'Ready.'
          })
          send({ type: 'response.output_item.done', output_index: 0, item: OUTPUT[0] })
          send({ type: 'response.completed', response: {
            ...response,
            status: 'completed',
            output: OUTPUT,
            usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 }
          } })
        }

        send({ type: 'response.created', response })

        if (requests.length === 1) {
          finish = complete

          if (accepted) {
            send({ type: 'response.in_progress', response })
          }
          if (commentary) {
            send({ type: 'response.output_item.added', output_index: 0, item: {
              type: 'message', id: 'progress', role: 'assistant', phase: 'commentary', content: []
            } })
            send({ type: 'response.output_text.delta', item_id: 'progress', output_index: 0,
              content_index: 0, delta: 'Checking.' })
          }

          return
        }

        complete()
      })
    })
    const params: PreparedCompletionParams = {
      dutyType: LLMDuties.ReAct,
      systemPrompt: 'Answer the request.',
      shouldStream: true,
      timeout: 120_000,
      temperature: 0,
      data: null,
      maxRetries: 1,
      remoteProviderErrorRetries: 1,
      onAttempt,
      onStreamEvent,
      onToken
    }
    const complete = (params: PreparedCompletionParams): ReturnType<typeof runCompletionAttempt> => {
      return runCompletionAttempt(
        provider,
        LLMProviders.OpenAI,
        'Continue the task.',
        params,
        'fixture',
        (retry) => complete({ ...params, ...retry }),
        reportError
      )
    }

    try {
      const pending = complete(params)
      await vi.waitFor(() => expect(onStreamEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'provider-event',
          providerEventType: accepted ? 'response.in_progress' : 'response.created'
        })
      ))

      if (accepted) {
        if (commentary) {
          await vi.waitFor(() => expect(onToken).toHaveBeenCalledWith('Checking.'))
          expect(onStreamEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'text-start', preliminary: true })
          )
        }
        const activityCount = onStreamEvent.mock.calls.filter(
          ([event]) => event.type === 'transport-activity'
        ).length

        await vi.advanceTimersByTimeAsync(60_000)
        await vi.waitFor(() => expect(ping).toHaveBeenCalled())
        expect(requests).toHaveLength(1)
        expect(onAttempt).toHaveBeenCalledTimes(1)
        expect(closed).not.toHaveBeenCalled()
        expect(onStreamEvent.mock.calls.filter(
          ([event]) => event.type === 'transport-activity'
        )).toHaveLength(activityCount)
        finish()
      } else {
        expect(onStreamEvent).not.toHaveBeenCalledWith(
          expect.objectContaining({ type: 'stream-open' })
        )
        await vi.advanceTimersByTimeAsync(12_000)
      }

      await vi.waitFor(() => expect(onAttempt.mock.calls.at(-1)?.[0].outcome).toBe('completed'))
      expect((await pending)?.output).toBe(commentary ? 'Checking.Ready.' : 'Ready.')
      expect(onToken.mock.calls.map(([token]) => token).filter(Boolean)).toEqual(
        commentary ? ['Checking.', 'Ready.'] : ['Ready.']
      )
      expect(reportError).not.toHaveBeenCalled()

      if (accepted) {
        expect(requests).toHaveLength(1)
        expect(onAttempt.mock.calls.at(-1)?.[0].requestAcceptedMs).toBeDefined()
      } else {
        const failure = onAttempt.mock.calls[1]![0]

        expect(failure.outcome).toBe('LLMRequestAcceptanceTimeout')
        expect(failure.elapsedMs - failure.requestDispatchMs).toBe(12_000)
        expect(failure.lastEvent).toBe('response.created')
        expect(failure.responseId).toBe(response.id)
        expect(requests).toHaveLength(2)
        expect(requests[1]?.['input']).toEqual(requests[0]?.['input'])
        expect(requests[1]?.['previous_response_id']).toBeUndefined()
        await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
      }

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      provider.dispose()
      vi.useRealTimers()
    }
  })

  it('reconnects interrupted requests with increasing waits and completes after recovery', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const provider = new AISDKRemoteLLMProvider({
      name: 'Fixture', providerName: LLMProviders.OpenAI, credentials: { api_key: 'fixture' },
      apiKeyEnv: 'LEON_OPENAI_API_KEY', model: 'gpt-6.1-sol',
      baseURL: url.slice(0, -'/responses'.length), flavor: 'openai-responses'
    })
    const requests: unknown[] = []
    const onConnectionRetry = vi.fn()
    const onAttempt = vi.fn()
    sockets.on('connection', (socket) => {
      socket.on('message', (data) => {
        requests.push(JSON.parse(data.toString()))
        if (requests.length < 3) {
          socket.terminate()
          return
        }
        for (const event of [
          { type: 'response.output_item.added', output_index: 0, item: { ...OUTPUT[0], content: [] } },
          { type: 'response.output_text.delta', item_id: 'message', output_index: 0, content_index: 0, delta: 'Ready.' },
          { type: 'response.output_item.done', output_index: 0, item: OUTPUT[0] },
          { type: 'response.completed', response: { id: 'recovered', output: OUTPUT, usage: { input_tokens: 10, output_tokens: 1 } } }
        ]) {
          socket.send(JSON.stringify(event))
        }
      })
    })
    const complete = (params: PreparedCompletionParams): ReturnType<typeof runCompletionAttempt> =>
      runCompletionAttempt(provider, LLMProviders.OpenAI, 'Continue.', params, 'fixture',
        (retry) => complete({ ...params, ...retry }), vi.fn())

    try {
      const pending = complete({
        dutyType: LLMDuties.ReAct, systemPrompt: '', shouldStream: true,
        timeout: 120_000, temperature: 0, data: null, maxRetries: 2,
        remoteProviderErrorRetries: 1, onConnectionRetry, onAttempt
      })
      await vi.waitFor(() => expect(onConnectionRetry).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(5_000)
      await vi.waitFor(() => expect(onConnectionRetry).toHaveBeenCalledTimes(2))
      await vi.advanceTimersByTimeAsync(10_000)
      await vi.waitFor(() => expect(onAttempt.mock.calls.at(-1)?.[0].outcome).toBe('completed'))

      expect((await pending)?.output).toBe('Ready.')
      expect(requests).toHaveLength(3)
      expect(requests[1]).toEqual(requests[0])
      expect(requests[2]).toEqual(requests[0])
      expect(onConnectionRetry.mock.calls.map(([notice]) => notice.delayMs)).toEqual([5_000, 10_000])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      provider.dispose()
      vi.useRealTimers()
    }
  })

  it.each([404, 405, 426, 501])('uses HTTP after an unsupported HTTP %s handshake without retrying the handshake', async (status) => {
    server.removeAllListeners('upgrade')
    let attempts = 0
    server.on('upgrade', (_request, socket) => {
      attempts += 1
      socket.end(`HTTP/1.1 ${status} Unsupported WebSocket\r\nConnection: close\r\n\r\n`)
    })

    expect(await request()).toContain('response.completed')
    expect(await request()).toContain('response.completed')
    expect(transport.transport).toBe('http')
    expect(attempts).toBe(1)
    expect(LogHelper.debug).toHaveBeenCalledWith(expect.stringContaining(`HTTP ${status}`))
  })

  it.each(['reset', 400, 429, 503])('preserves a %s opening failure and retries WebSocket on the next request', async (failure) => {
    server.removeAllListeners('upgrade')
    const http = vi.fn()
    let attempts = 0
    server.on('request', http)
    server.on('upgrade', (request, socket, head) => {
      attempts += 1

      if (attempts === 1) {
        if (failure === 'reset') {
          socket.destroy()
        } else {
          socket.end(`HTTP/1.1 ${failure} Rejected\r\nConnection: close\r\n\r\n`)
        }

        return
      }

      sockets.handleUpgrade(request, socket, head, (connection) => {
        sockets.emit('connection', connection, request)
      })
    })
    sockets.on('connection', (socket) => {
      socket.on('message', () => {
        socket.send(JSON.stringify({
          type: 'response.completed', response: { id: 'recovered', output: OUTPUT }
        }))
      })
    })

    await expect(request()).rejects.toMatchObject({
      ...(failure === 'reset' ? { code: 'ECONNRESET' } : { statusCode: failure }),
      transportPhase: 'handshake',
      handshakeDurationMs: expect.any(Number)
    })
    expect(http).not.toHaveBeenCalled()
    expect(await request()).toContain('recovered')
    expect(transport.transport).toBe('websocket')
    expect(attempts).toBe(2)
  })

  it.each([true, false])('logs request-local heartbeat timing on disconnect (pong received: %s)', async (acknowledge) => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    sockets.options.autoPong = false
    const received = vi.fn()
    sockets.on('connection', (socket) => {
      socket.on('message', received)
      socket.on('ping', (data) => {
        vi.setSystemTime(Number(data.toString()) + 25)
        socket.pong(String(Number(data.toString()) - 1))
        if (acknowledge) {
          socket.pong(data)
        }

        socket.close(1_011, 'Upstream failure')
      })
    })

    try {
      const pending = request().catch((error: unknown) => error)
      await vi.waitFor(() => expect(received).toHaveBeenCalledOnce())
      await vi.advanceTimersByTimeAsync(5_000)
      const error = await pending

      expect(error).toMatchObject({
        transportPhase: 'response',
        closeCode: 1_011,
        pingCount: 1,
        pongCount: acknowledge ? 1 : 0,
        lastPingAgeMs: expect.any(Number),
        lastPongAgeMs: acknowledge ? expect.any(Number) : undefined,
        lastPongRttMs: acknowledge ? expect.any(Number) : undefined
      })
      const timing = error as {
        lastPingAgeMs: number
        lastPongAgeMs: number
        lastPongRttMs: number
      }

      expect(timing.lastPingAgeMs).toBeGreaterThanOrEqual(25)
      if (acknowledge) {
        expect(timing.lastPongRttMs).toBeGreaterThanOrEqual(25)
        expect(timing.lastPingAgeMs).toBe(timing.lastPongRttMs + timing.lastPongAgeMs)
      }
      expect(formatPromptErrorForLog(error)).toContain('"pingCount":1')
      expect(formatPromptErrorForLog(error)).toContain(`"pongCount":${acknowledge ? 1 : 0}`)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains heartbeat evidence when a local watchdog cancels the response', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const activity = new ProviderRequestActivity()
    const controller = new AbortController()
    const received = vi.fn()
    sockets.on('connection', (socket) => {
      socket.on('message', received)
    })

    try {
      const pending = request(INPUT, {}, controller.signal, (event) => activity.observe(event))
        .catch((error: unknown) => error)
      await vi.waitFor(() => expect(received).toHaveBeenCalledOnce())
      await vi.advanceTimersByTimeAsync(5_000)
      await vi.waitFor(() => expect(activity.snapshot().pongCount).toBe(1))
      vi.setSystemTime(Date.now() + 1_000)
      const error = new Error('Model stream idle timeout')
      controller.abort(error)

      expect(await pending).toBe(error)
      expect(activity.snapshot()).toMatchObject({
        pingCount: 1, pongCount: 1,
        lastPingAgeMs: expect.any(Number), lastPongAgeMs: expect.any(Number),
        lastPongRttMs: expect.any(Number), providerEventCount: 0
      })
      expect(activity.snapshot().lastPongAgeMs).toBeGreaterThanOrEqual(1_000)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
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

  it.each(['disconnect', 'connection expiry'])('reports %s after output without transport replay', async (ending) => {
    const http = vi.fn()
    const dispatched = vi.fn()
    server.on('request', http)
    sockets.on('connection', (socket) => {
      socket.on('message', () => {
        dispatched()
        socket.send(JSON.stringify({
          type: 'response.output_text.delta', delta: 'Provisional.'
        }))

        if (ending === 'disconnect') {
          socket.close(1_011, 'Upstream stream failed')
        } else {
          socket.send(JSON.stringify({
            type: 'error',
            error: {
              code: 'websocket_connection_limit_reached',
              message: 'Connection expired.'
            },
            status: 400
          }))
        }
      })
    })

    const pending = request()

    await expect(pending).rejects.toThrow(
      ending === 'disconnect' ? 'before terminal completion' : 'Connection expired.'
    )
    if (ending === 'disconnect') {
      await expect(pending).rejects.toMatchObject({
        closeCode: 1_011,
        closeReason: 'Upstream stream failed'
      })
    }
    expect(dispatched).toHaveBeenCalledOnce()
    expect(http).not.toHaveBeenCalled()
  })
})
