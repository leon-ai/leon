import { isDeepStrictEqual } from 'node:util'
import type { ClientRequest, IncomingMessage } from 'node:http'

import WebSocket, { type RawData } from 'ws'

import type { CompletionParams } from '@/core/llm-manager/types'

interface CompletedResponse {
  id: string
  input: unknown[]
  options: Record<string, unknown>
}

enum WebSocketPhase {
  Handshake = 'handshake',
  Upload = 'upload',
  Response = 'response'
}

const EXPIRED_CONTINUATION_CODES = new Set([
  'previous_response_not_found',
  'previous_response_id_not_found'
])
// Retire idle connections before the provider's 60-minute lifetime expires.
const MAXIMUM_CONNECTION_AGE_MS = 55 * 60_000
const KEEP_ALIVE_INTERVAL_MS = 5_000
// Leave headroom below the authenticated route's observed 16 MiB boundary.
const MAXIMUM_REQUEST_BYTES = 15 * 1_024 * 1_024
const CONNECTION_LIMIT_ERROR_CODE = 'websocket_connection_limit_reached'
const TERMINAL_EVENTS = new Set([
  'response.completed',
  'response.failed',
  'response.incomplete',
  'error'
])

/**
 * Keeps one authenticated Responses connection and adapts its events to SSE.
 * Continuations reuse only an exact, successfully completed wire transcript.
 */
export class OpenAIResponsesWebSocket {
  private socket: WebSocket | undefined
  private connectedAt = 0
  private previous: CompletedResponse | undefined
  public busy = false

  public constructor(
    private readonly url: string,
    private readonly headers: Record<string, string>
  ) {}

  /**
   * Cancels pending generation and discards connection-local continuation state.
   */
  public close(): void {
    this.previous = undefined
    this.connectedAt = 0
    this.socket?.terminate()
    this.socket = undefined
  }

  /**
   * Opens the connection before dispatch so unsupported handshakes can fall back
   * without replaying an accepted generation or any visible model output.
   */
  public async fetch(
    body: Record<string, unknown>,
    signal?: AbortSignal,
    onStreamEvent?: CompletionParams['onStreamEvent']
  ): Promise<Response> {
    signal?.throwIfAborted()
    this.busy = true
    const abort = (): void => {
      this.close()
    }
    signal?.addEventListener('abort', abort, { once: true })

    let socket: WebSocket
    const handshakeStartedAt = Date.now()

    try {
      socket = await this.connect()
      signal?.throwIfAborted()
    } catch (error) {
      signal?.removeEventListener('abort', abort)
      this.busy = false
      this.close()
      signal?.throwIfAborted()
      if (error instanceof Error) {
        Object.assign(error, {
          transportPhase: WebSocketPhase.Handshake,
          handshakeDurationMs: Date.now() - handshakeStartedAt
        })
      }

      throw error
    }

    const { input } = body
    const options = { ...body }
    delete options['input']
    delete options['stream']
    delete options['previous_response_id']
    const items = Array.isArray(input) ? input : []
    const previous = this.previous
    const canContinue = previous && Array.isArray(input) &&
      isDeepStrictEqual(options, previous.options) &&
      items.length >= previous.input.length &&
      isDeepStrictEqual(items.slice(0, previous.input.length), previous.input)
    const request = {
      ...options,
      type: 'response.create',
      input: canContinue ? items.slice(previous.input.length) : input,
      ...(canContinue ? { previous_response_id: previous.id } : {})
    }
    this.previous = undefined

    const encoder = new TextEncoder()
    const outputItems = new Map<number, unknown>()
    const responseStream = new ReadableStream<Uint8Array>({
      start: (controller): void => {
        let finished = false
        let hasOutput = false
        let retriedContinuation = false
        let retriedConnection = false
        const pendingPings = new Set<string>()
        let pingCount = 0
        let pongCount = 0
        let lastPingAt: number | undefined
        let lastPongAt: number | undefined
        let lastPongRttMs: number | undefined
        let requestBytes = 0
        let uploadStartedAt: number | undefined
        let uploadDurationMs: number | undefined

        // Publish heartbeat evidence independently of provider output so local
        // watchdog failures retain socket health without extending generation.
        const reportHeartbeat = (): void => {
          onStreamEvent?.({
            type: 'transport-heartbeat', transport: 'websocket',
            heartbeat: { pingCount, pongCount, lastPingAt, lastPongAt, lastPongRttMs }
          })
        }

        // Reasoning can be silent long enough for intermediaries to drop the
        // socket. Protocol pings preserve transport without claiming model progress.
        const keepAliveTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            lastPingAt = Date.now()
            pingCount += 1
            const payload = String(lastPingAt)
            pendingPings.add(payload)
            reportHeartbeat()
            socket.ping(payload, undefined, (error) => {
              if (error) {
                fail(error)
              }
            })
          }
        }, KEEP_ALIVE_INTERVAL_MS)
        keepAliveTimer.unref()

        const cleanup = (): void => {
          finished = true
          clearInterval(keepAliveTimer)
          socket.off('message', onMessage)
          socket.off('error', onError)
          socket.off('close', onClose)
          socket.off('pong', onPong)
          signal?.removeEventListener('abort', onAbort)
          signal?.removeEventListener('abort', abort)
          this.busy = false
        }
        const fail = (error: unknown): void => {
          if (finished) {
            return
          }

          // Attach only request-local protocol diagnostics. Owner cancellation
          // keeps its original reason, and heartbeats never renew model progress.
          if (error instanceof Error && !signal?.aborted) {
            const now = Date.now()

            Object.assign(error, {
              transportPhase: hasOutput || uploadDurationMs !== undefined
                ? WebSocketPhase.Response
                : WebSocketPhase.Upload,
              requestBytes,
              maximumRequestBytes: MAXIMUM_REQUEST_BYTES,
              uploadDurationMs,
              uploadElapsedMs: uploadStartedAt === undefined || uploadDurationMs !== undefined
                ? undefined
                : now - uploadStartedAt,
              pingCount,
              pongCount,
              lastPingAgeMs: lastPingAt === undefined ? undefined : now - lastPingAt,
              lastPongAgeMs: lastPongAt === undefined ? undefined : now - lastPongAt,
              lastPongRttMs
            })
          }

          cleanup()
          this.close()
          controller.error(error)
        }
        const onError = (error: Error): void => {
          fail(error)
        }
        const onClose = (closeCode: number, reason: Buffer): void => {
          fail(Object.assign(
            new Error('The provider socket closed before terminal completion.'),
            { closeCode, closeReason: reason.toString() }
          ))
        }
        const onAbort = (): void => {
          fail(signal?.reason)
        }
        const onPong = (data: Buffer): void => {
          const payload = data.toString()

          // Ignore unsolicited pongs and echoes from a preceding request.
          if (!pendingPings.delete(payload)) {
            return
          }

          const now = Date.now()

          pongCount += 1
          lastPongAt = now
          lastPongRttMs = now - Number(payload)
          reportHeartbeat()
        }
        const send = (request: Record<string, unknown>): void => {
          const serialized = JSON.stringify(request)
          requestBytes = Buffer.byteLength(serialized)
          uploadStartedAt = undefined
          uploadDurationMs = undefined
          onStreamEvent?.({
            type: 'request-upload-start', transport: 'websocket', requestBytes
          })

          // Measure the actual continuation or replay, including data URLs and
          // schemas. Token budgets cannot detect oversized WebSocket messages.
          if (requestBytes > MAXIMUM_REQUEST_BYTES) {
            fail(Object.assign(new Error(
              `OpenAI WebSocket request is ${requestBytes} bytes; the request budget is ${MAXIMUM_REQUEST_BYTES} bytes. Reinspect images with compact previews or use a smaller inspection batch.`
            ), { statusCode: 413 }))
            return
          }

          uploadStartedAt = Date.now()
          socket.send(serialized, (error) => {
            if (error) {
              fail(error)
              return
            }
            if (!finished) {
              uploadDurationMs = Date.now() - uploadStartedAt!
              onStreamEvent?.({
                type: 'request-uploaded', transport: 'websocket',
                requestBytes, uploadDurationMs
              })
            }
          })
        }
        const listen = (): void => {
          socket.on('message', onMessage)
          socket.on('error', onError)
          socket.on('close', onClose)
          socket.on('pong', onPong)
        }
        const onMessage = async (data: RawData): Promise<void> => {
          try {
            const text = data.toString()
            const event = JSON.parse(text) as Record<string, unknown>
            const error = event['error'] as Record<string, unknown> | undefined
            const code = error?.['code'] ?? event['code']

            // An explicit rejection before any response events is safe to
            // replay. New sockets cannot use connection-local response IDs.
            if (event['type'] === 'error' && !hasOutput &&
              !retriedConnection && code === CONNECTION_LIMIT_ERROR_CODE) {
              retriedConnection = true
              socket.off('message', onMessage)
              socket.off('error', onError)
              socket.off('close', onClose)
              socket.off('pong', onPong)
              this.close()
              socket = await this.connect()
              signal?.throwIfAborted()

              if (finished) {
                return
              }

              listen()
              send({ ...options, type: 'response.create', input })
              return
            }

            // A server can expire its connection-local response cache. Retry
            // only a rejected continuation, before any generation was emitted.
            if (event['type'] === 'error' && canContinue && !hasOutput &&
              !retriedContinuation &&
              EXPIRED_CONTINUATION_CODES.has(String(code))) {
              retriedContinuation = true
              send({ ...options, type: 'response.create', input })
              return
            }

            // WebSocket errors have a different envelope from SSE errors.
            // Preserve their meaning before the SDK validates response chunks.
            if (event['type'] === 'error') {
              const message = error?.['message'] ?? event['message'] ??
                'The provider WebSocket request failed.'

              fail(Object.assign(
                new Error(String(message)),
                { code, statusCode: event['status'], error }
              ))
              return
            }

            hasOutput = true

            if (event['type'] === 'response.output_item.done' &&
              typeof event['output_index'] === 'number') {
              outputItems.set(event['output_index'], event['item'])
            }

            controller.enqueue(encoder.encode(`data: ${text}\n\n`))
            if (!TERMINAL_EVENTS.has(String(event['type']))) {
              return
            }

            if (event['type'] === 'response.completed') {
              const response = event['response'] as Record<string, unknown> | undefined
              const output = Array.isArray(response?.['output']) && response['output'].length
                ? response['output']
                : [...outputItems].sort(([left], [right]) => left - right)
                    .map(([, item]) => item)

              // Compaction changes the canonical history; resume it with a full
              // request rather than extending a different server-side window.
              if (typeof response?.['id'] === 'string' && Array.isArray(input) &&
                !output.some((item) => item?.type === 'compaction')) {
                this.previous = {
                  id: response['id'],
                  input: [...items, ...output],
                  options
                }
              }
            }

            cleanup()
            if (event['type'] !== 'response.completed') {
              this.close()
            }
            controller.close()
          } catch (error) {
            fail(error)
          }
        }

        listen()
        signal?.addEventListener('abort', onAbort, { once: true })

        try {
          signal?.throwIfAborted()
          send(request)
        } catch (error) {
          fail(error)
        }
      },
      cancel: (): void => {
        signal?.removeEventListener('abort', abort)
        this.close()
      }
    })

    return new Response(responseStream, {
      headers: { 'content-type': 'text/event-stream' }
    })
  }

  private async connect(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN &&
      Date.now() - this.connectedAt < MAXIMUM_CONNECTION_AGE_MS) {
      return this.socket
    }

    this.close()
    const socket = new WebSocket(this.url, {
      headers: this.headers,
      followRedirects: false
    })
    this.socket = socket
    // Keep an error listener while idle, when no response stream owns events.
    socket.on('error', (): void => {
      if (this.socket === socket) {
        this.previous = undefined
      }
    })
    socket.once('close', (): void => {
      if (this.socket === socket) {
        this.socket = undefined
        this.previous = undefined
      }
    })

    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        socket.off('open', onOpen)
        socket.off('error', onError)
        socket.off('close', onClose)
        socket.off('unexpected-response', onResponse)
      }
      const onOpen = (): void => {
        cleanup()
        this.connectedAt = Date.now()
        resolve(socket)
      }
      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const onClose = (closeCode: number, reason: Buffer): void => {
        onError(Object.assign(
          new Error('The provider socket closed during connection.'),
          { closeCode, closeReason: reason.toString() }
        ))
      }
      const onResponse = (_request: ClientRequest, response: IncomingMessage): void => {
        response.resume()
        onError(Object.assign(
          new Error(`The provider WebSocket handshake returned HTTP ${response.statusCode}.`),
          { statusCode: response.statusCode }
        ))
        socket.terminate()
      }
      socket.once('open', onOpen)
      socket.once('error', onError)
      socket.once('close', onClose)
      socket.once('unexpected-response', onResponse)
    })
  }
}
