import { isDeepStrictEqual } from 'node:util'
import type { ClientRequest, IncomingMessage } from 'node:http'

import WebSocket, { type RawData } from 'ws'

interface CompletedResponse {
  id: string
  input: unknown[]
  options: Record<string, unknown>
}

const EXPIRED_CONTINUATION_CODES = new Set([
  'previous_response_not_found',
  'previous_response_id_not_found'
])
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
    this.socket?.terminate()
    this.socket = undefined
  }

  /**
   * Opens the connection before dispatch so unsupported handshakes can fall back
   * without replaying an accepted generation or any visible model output.
   */
  public async fetch(
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Response> {
    signal?.throwIfAborted()
    this.busy = true
    const abort = (): void => {
      this.close()
    }
    signal?.addEventListener('abort', abort, { once: true })

    let socket: WebSocket
    try {
      socket = await this.connect()
      signal?.throwIfAborted()
    } catch (error) {
      signal?.removeEventListener('abort', abort)
      this.busy = false
      this.close()
      signal?.throwIfAborted()
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
        const cleanup = (): void => {
          finished = true
          socket.off('message', onMessage)
          socket.off('error', onError)
          socket.off('close', onClose)
          signal?.removeEventListener('abort', onAbort)
          signal?.removeEventListener('abort', abort)
          this.busy = false
        }
        const fail = (error: unknown): void => {
          if (finished) {
            return
          }

          cleanup()
          this.close()
          controller.error(error)
        }
        const onError = (error: Error): void => {
          fail(error)
        }
        const onClose = (): void => {
          fail(new Error('The provider socket closed before terminal completion.'))
        }
        const onAbort = (): void => {
          fail(signal?.reason)
        }
        const onMessage = (data: RawData): void => {
          try {
            const text = data.toString()
            const event = JSON.parse(text) as Record<string, unknown>
            const error = event['error'] as Record<string, unknown> | undefined

            // A server can expire its connection-local response cache. Retry
            // only a rejected continuation, before any generation was emitted.
            if (event['type'] === 'error' && canContinue && !hasOutput &&
              !retriedContinuation &&
              EXPIRED_CONTINUATION_CODES.has(String(error?.['code'] ?? event['code']))) {
              retriedContinuation = true
              socket.send(JSON.stringify({ ...options, type: 'response.create', input }))
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

        socket.on('message', onMessage)
        socket.on('error', onError)
        socket.on('close', onClose)
        signal?.addEventListener('abort', onAbort, { once: true })

        try {
          signal?.throwIfAborted()
          socket.send(JSON.stringify(request), (error) => {
            if (error) {
              fail(error)
            }
          })
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
    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.socket
    }

    this.previous = undefined
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
        resolve(socket)
      }
      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const onClose = (): void => {
        onError(new Error('The provider socket closed during connection.'))
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
