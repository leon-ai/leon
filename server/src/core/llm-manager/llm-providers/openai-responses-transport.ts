import { createWebSocketFetch } from '@vercel/ai-sdk-openai-websocket-fetch'
import { requestChatGPTAccount } from '../llm-accounts/chatgpt-account-request'
import { ProviderPromptCache } from './prompt-cache'
import { readProviderUsage } from '@/core/llm-manager/llm-usage/usage-context'
import type { CompletionParams, PromptCacheObservation } from '@/core/llm-manager/types'

const CHATGPT_UNSUPPORTED_FIELDS = [
  'background',
  'conversation',
  'max_output_tokens',
  'max_tool_calls',
  'metadata',
  'moderation',
  'multi_agent',
  'prompt',
  'prompt_cache_retention',
  'safety_identifier',
  'temperature',
  'top_logprobs',
  'top_p',
  'truncation',
  'user',
  'previous_response_id'
]
const OPENAI_TERMINAL_EVENTS = new Set([
  'response.completed',
  'response.failed',
  'response.incomplete',
  'error'
])
const SSE_EVENT_BOUNDARY = /\r\n\r\n|\n\n|\r\r/
const SSE_LINE_BOUNDARY = /\r\n|\r|\n/

/**
 * Shares authenticated Responses transport between inference and auxiliary requests.
 */
export class OpenAIResponsesTransport {
  private openAIWebSocketFetch: ReturnType<typeof createWebSocketFetch> | undefined
  private openAIWebSocketAuthorization: string | undefined
  private readonly promptCache = new ProviderPromptCache()

  constructor(
    private readonly baseURL: string,
    private readonly accountId?: string,
    private readonly onDispatch?: (endpoint: string) => void
  ) {
  }

  /**
   * Uses the bound account without falling back to another profile credential.
   */
  public async fetch(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit,
    onStreamEvent?: CompletionParams['onStreamEvent']
  ): Promise<Response> {
    let observation: PromptCacheObservation | undefined
    const observe: CompletionParams['onStreamEvent'] = (event) => {
      observation = event.promptCache ?? observation
      onStreamEvent?.(event)
    }
    const response = await (this.accountId
      ? this.fetchChatGPT(input, init, observe)
      : this.fetchOpenAI(input, init, observe))

    onStreamEvent?.({
      type: 'response-headers',
      transport: this.accountId ? 'http' : 'websocket',
      ...(response.headers.get('x-request-id')
        ? { requestId: response.headers.get('x-request-id')! }
        : {})
    })

    return this.finishResponseStream(response, onStreamEvent, observation)
  }

  /**
   * Retires in-flight or stale connections before they can be reused.
   */
  public close(): void {
    this.openAIWebSocketFetch?.close()
    this.openAIWebSocketFetch = undefined
  }

  /**
   * Applies subscription request requirements and refreshes rejected authorization.
   */
  private async fetchChatGPT(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit,
    onStreamEvent?: CompletionParams['onStreamEvent']
  ): Promise<Response> {
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    for (const field of CHATGPT_UNSUPPORTED_FIELDS) {
      delete body[field]
    }

    body['stream'] = true
    body['store'] = false
    body['include'] = [...new Set([
      ...(Array.isArray(body['include']) ? body['include'] : []),
      'reasoning.encrypted_content'
    ])]
    // Codex receives system instructions as developer messages.
    const items = Array.isArray(body['input'])
      ? body['input'] as Record<string, unknown>[]
      : typeof body['input'] === 'string'
        ? [{ role: 'user', content: body['input'] }]
        : []
    body['input'] = items.map((item) => {
      if (item['role'] === 'system') {
        return { ...item, role: 'developer' }
      }

      return item
    })
    body['instructions'] ??= ''
    const { sessionId, observation } = this.promptCache.prepare(
      body,
      String(this.accountId)
    )

    return requestChatGPTAccount(String(this.accountId), async (accountHeaders) => {
      const headers = new Headers(init?.headers)
      for (const [name, value] of Object.entries(accountHeaders)) {
        headers.set(name, value)
      }
      if (sessionId) {
        headers.set('session_id', sessionId)
      }
      if (observation) {
        headers.set('x-client-request-id', observation.key)
        onStreamEvent?.({ type: 'prompt-cache', promptCache: observation })
      }

      // The WebSocket adapter drops custom headers. Codex needs its workspace
      // header on the handshake, so use its native HTTP/SSE transport here.
      init?.signal?.throwIfAborted()
      this.onDispatch?.(String(input))
      onStreamEvent?.({ type: 'request-dispatched', transport: 'http' })

      return globalThis.fetch(input, {
        ...init,
        headers,
        body: JSON.stringify(body),
        redirect: 'error'
      })
    })
  }

  /**
   * Rotates authenticated API-key sockets when their authorization changes.
   */
  private async fetchOpenAI(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit,
    onStreamEvent?: CompletionParams['onStreamEvent']
  ): Promise<Response> {
    init?.signal?.throwIfAborted()
    const authorization = new Headers(init?.headers).get('authorization') || ''
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    const { observation } = this.promptCache.prepare(
      body,
      JSON.stringify([this.baseURL, authorization])
    )

    if (observation) {
      init = { ...init, body: JSON.stringify(body) }
      onStreamEvent?.({ type: 'prompt-cache', promptCache: observation })
    }
    if (this.openAIWebSocketAuthorization !== authorization) {
      this.openAIWebSocketFetch?.close()
      this.openAIWebSocketFetch = undefined
      this.openAIWebSocketAuthorization = authorization
    }

    const transport = this.getOpenAIWebSocketFetch()
    try {
      this.onDispatch?.(this.toOpenAIResponsesWebSocketURL(this.baseURL))
      onStreamEvent?.({ type: 'request-dispatched', transport: 'websocket' })
      const response = await transport(input, init)
      if (init?.signal?.aborted) {
        transport.close()
        await response.body?.cancel()
        init.signal.throwIfAborted()
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel()
        throw Object.assign(new Error('OpenAI authorization was rejected.'), {
          statusCode: response.status
        })
      }

      return response
    } catch (error) {
      // A rejected handshake or canceled opening must not leave reusable state.
      transport.close()
      if (this.openAIWebSocketFetch === transport) {
        this.openAIWebSocketFetch = undefined
      }
      throw error
    }
  }

  /**
   * Let the SDK flush terminal usage without waiting for a remote connection to close.
   */
  private finishResponseStream(
    response: Response,
    onStreamEvent?: CompletionParams['onStreamEvent'],
    observation?: PromptCacheObservation
  ): Response {
    if (!response.body) {
      return response
    }

    // Native Responses requests use SSE even when a subscription omits its header.
    const headers = new Headers(response.headers)

    if (response.ok && !headers.has('content-type')) {
      headers.set('content-type', 'text/event-stream')
    }
    if (!headers.get('content-type')?.includes('text/event-stream')) {
      return response
    }

    let pending = ''
    const body = response.body
      // Observe bytes before framing or SDK lookahead can delay parsed events.
      .pipeThrough(new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
        transform: (chunk, controller): void => {
          if (chunk.byteLength > 0) {
            onStreamEvent?.({
              type: 'transport-activity',
              transport: this.accountId ? 'http' : 'websocket'
            })
          }

          controller.enqueue(chunk)
        }
      }))
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TransformStream<string, string>({
        transform: (chunk, controller): void => {
          pending += chunk
          let boundary = SSE_EVENT_BOUNDARY.exec(pending)

          while (boundary) {
            const end = boundary.index + boundary[0].length
            const frame = pending.slice(0, end)
            pending = pending.slice(end)
            controller.enqueue(frame)

            const data = frame.split(SSE_LINE_BOUNDARY)
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice('data:'.length).trimStart())
              .join('\n')
            let event: Record<string, unknown> | undefined

            try {
              event = JSON.parse(data) as Record<string, unknown>
            } catch {
              // Leave protocol validation and provider errors to the SDK.
            }

            if (event && OPENAI_TERMINAL_EVENTS.has(String(event['type']))) {
              if (observation && event['type'] === 'response.completed') {
                const result = event['response'] as Record<string, unknown> | undefined
                const usage = readProviderUsage(result?.['usage'])

                onStreamEvent?.({
                  type: 'prompt-cache',
                  promptCache: {
                    ...observation,
                    ...(usage.inputTokens !== undefined
                      ? { inputTokens: usage.inputTokens }
                      : {}),
                    ...(usage.cachedInputTokens !== undefined
                      ? { cachedInputTokens: usage.cachedInputTokens }
                      : {})
                  }
                })
              }
              if (event['type'] !== 'response.completed') {
                this.close()
              }

              controller.terminate()
              return
            }

            boundary = SSE_EVENT_BOUNDARY.exec(pending)
          }
        },
        flush(): void {
          // EOF without a terminal event must not turn a partial draft into success.
          throw new Error('The provider stream ended before terminal completion.')
        }
      }))
      .pipeThrough(new TextEncoderStream())

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  }

  private getOpenAIWebSocketFetch(): ReturnType<typeof createWebSocketFetch> {
    if (!this.openAIWebSocketFetch) {
      this.openAIWebSocketFetch = createWebSocketFetch({
        url: this.toOpenAIResponsesWebSocketURL(this.baseURL)
      })
    }

    return this.openAIWebSocketFetch
  }

  private toOpenAIResponsesWebSocketURL(baseURL: string): string {
    const url = new URL(baseURL)
    const normalizedBasePath = url.pathname.endsWith('/')
      ? url.pathname
      : `${url.pathname}/`

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = new URL('responses', `http://localhost${normalizedBasePath}`)
      .pathname
    url.search = ''
    url.hash = ''

    return url.toString()
  }
}
