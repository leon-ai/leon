import { createHash } from 'node:crypto'

import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'
import { OpenAIResponsesWebSocket } from './openai-responses-websocket'
import { CONFIG_MANAGER } from '@/config'
import { getLLMModelCatalogEntry } from '@/core/llm-manager/llm-model-catalog'
import { AGENT_PROMPT_CACHE_KEY } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-constants'
import { requestChatGPTAccount } from '../llm-accounts/chatgpt-account-request'
import { ProviderPromptCache } from './prompt-cache'
import { readProviderUsage } from '@/core/llm-manager/llm-usage/usage-context'
import type { CompletionParams, PromptCacheObservation } from '@/core/llm-manager/types'
import { LLMProviders } from '@/core/llm-manager/types'
import { LogHelper } from '@/helpers/log-helper'

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
const MAXIMUM_WEBSOCKET_SESSIONS = 32
const UNSUPPORTED_WEBSOCKET_STATUSES = new Set([404, 405, 426, 501])
const CONNECTION_IDENTITY_HEADERS = [
  'authorization', 'chatgpt-account-id', 'originator', 'session_id'
]

interface ResponsesConnection {
  signature: string
  socket: OpenAIResponsesWebSocket
  http: boolean
}

interface TransportResponse {
  response: Response
  transport: 'http' | 'websocket'
  socket?: OpenAIResponsesWebSocket
}

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
  private readonly connections = new Map<string, ResponsesConnection>()
  public transport: 'http' | 'websocket' = 'websocket'
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
    const result = await (this.accountId
      ? this.fetchChatGPT(input, init, observe)
      : this.fetchOpenAI(input, init, observe))

    const { response, transport, socket } = result
    this.transport = transport
    onStreamEvent?.({
      type: 'response-headers',
      transport,
      ...(response.headers.get('x-request-id')
        ? { requestId: response.headers.get('x-request-id')! }
        : {})
    })

    return this.finishResponseStream(response, transport, socket, onStreamEvent, observation)
  }

  /**
   * Retires in-flight or stale connections before they can be reused.
   */
  public close(): void {
    for (const connection of this.connections.values()) {
      connection.socket.close()
    }

    this.connections.clear()
  }

  /**
   * Applies subscription request requirements and refreshes rejected authorization.
   */
  private async fetchChatGPT(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit,
    onStreamEvent?: CompletionParams['onStreamEvent']
  ): Promise<TransportResponse> {
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

    let result: TransportResponse | undefined
    await requestChatGPTAccount(String(this.accountId), async (accountHeaders) => {
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

      result = await this.fetchAuthenticated(input, {
        ...init,
        headers,
        body: JSON.stringify(body),
        redirect: 'error'
      }, onStreamEvent)

      return result.response
    })

    return result!
  }

  /**
   * Applies API-key cache hints before selecting the authenticated transport.
   */
  private async fetchOpenAI(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit,
    onStreamEvent?: CompletionParams['onStreamEvent']
  ): Promise<TransportResponse> {
    init?.signal?.throwIfAborted()
    const authorization = new Headers(init?.headers).get('authorization') || ''
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    const shareAcrossSessions = this.prepareInstructionsCache(body)
    const { observation } = this.promptCache.prepare(
      body,
      JSON.stringify([this.baseURL, authorization]),
      false,
      'agent',
      shareAcrossSessions
    )

    if (observation) {
      init = { ...init, body: JSON.stringify(body) }
      onStreamEvent?.({ type: 'prompt-cache', promptCache: observation })
    }
    return this.fetchAuthenticated(input, init, onStreamEvent)
  }

  /**
   * Keeps sockets private to a profile, conversation and authenticated binding.
   * HTTP fallback is allowed only before a WebSocket request was dispatched.
   */
  private async fetchAuthenticated(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit,
    onStreamEvent?: CompletionParams['onStreamEvent']
  ): Promise<TransportResponse> {
    init?.signal?.throwIfAborted()
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    // Per-request trace and cache hints must not rotate an authenticated socket.
    const signature = createHash('sha256').update(JSON.stringify(
      CONNECTION_IDENTITY_HEADERS.map((name) => headers[name])
    )).digest('hex')
    const scope = JSON.stringify([
      getActiveProfileName(), getActiveConversationSessionId()
    ])
    let connection = this.connections.get(scope)

    if (connection && connection.signature !== signature && !connection.socket.busy) {
      connection.socket.close()
      this.connections.delete(scope)
      connection = undefined
    }
    if (!connection) {
      if (this.connections.size >= MAXIMUM_WEBSOCKET_SESSIONS) {
        const idle = [...this.connections].find(([, entry]) => !entry.socket.busy)

        if (idle) {
          idle[1].socket.close()
          this.connections.delete(idle[0])
        }
      }

      connection = {
        signature,
        socket: new OpenAIResponsesWebSocket(
          this.toOpenAIResponsesWebSocketURL(this.baseURL), headers
        ),
        http: false
      }
      this.connections.set(scope, connection)
    }

    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    // Concurrent requests must not share one socket's event stream or lineage.
    if (connection.signature === signature && !connection.http &&
      !connection.socket.busy && body['stream'] === true) {
      try {
        this.onDispatch?.(this.toOpenAIResponsesWebSocketURL(this.baseURL))
        onStreamEvent?.({ type: 'request-dispatched', transport: 'websocket' })
        const response = await connection.socket.fetch(body, init?.signal ?? undefined, onStreamEvent)
        init?.signal?.throwIfAborted()

        return { response, transport: 'websocket', socket: connection.socket }
      } catch (error) {
        connection.socket.close()
        init?.signal?.throwIfAborted()
        const status = (error as { statusCode?: number }).statusCode

        // A reset or generic rejection does not establish protocol incompatibility.
        // Preserve it for the normal retry policy so the next attempt opens a socket.
        if (status === undefined || !UNSUPPORTED_WEBSOCKET_STATUSES.has(status)) {
          throw error
        }

        LogHelper.debug(`OpenAI Responses HTTP fallback after unsupported WebSocket handshake (HTTP ${status})`)
        connection.http = true
      }
    }

    this.onDispatch?.(String(input))
    onStreamEvent?.({ type: 'request-dispatched', transport: 'http' })
    const response = await globalThis.fetch(input, init)

    return { response, transport: 'http' }
  }

  /**
   * Gives only the stable agent instruction prefix extended coverage. Apply
   * wire options here so SDK validation cannot discard per-block lifetimes.
   */
  private prepareInstructionsCache(body: Record<string, unknown>): boolean {
    const model = body['model']

    if (body['prompt_cache_key'] !== AGENT_PROMPT_CACHE_KEY ||
      typeof model !== 'string' ||
      !getLLMModelCatalogEntry(LLMProviders.OpenAI, model)?.supportsPromptCacheOptions ||
      (CONFIG_MANAGER.getConfig().llm.model_settings[`openai/${model}`]
        ?.instructions_cache_ttl ?? '12h') !== '12h' ||
      !Array.isArray(body['input'])) {
      return false
    }

    const instructions = body['input'][0] as Record<string, unknown> | undefined

    if (!instructions ||
      (instructions['role'] !== 'developer' && instructions['role'] !== 'system')) {
      return false
    }

    const content = typeof instructions['content'] === 'string'
      ? [{ type: 'input_text', text: instructions['content'] }]
      : instructions['content']

    if (!Array.isArray(content)) {
      return false
    }

    const index = content.findLastIndex((part) => part?.type === 'input_text')

    if (index < 0) {
      return false
    }

    // All later messages keep the short lifetime, including fresh host state.
    instructions['content'] = content.map((part, partIndex) => partIndex === index
      ? { ...part, prompt_cache_breakpoint: { mode: 'explicit', ttl: '12h' } }
      : part)
    body['prompt_cache_options'] = { mode: 'implicit', ttl: '30m' }
    delete body['prompt_cache_retention']

    return true
  }

  /**
   * Let the SDK flush terminal usage without waiting for a remote connection to close.
   */
  private finishResponseStream(
    response: Response,
    transport: 'http' | 'websocket',
    socket: OpenAIResponsesWebSocket | undefined,
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
              transport
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

            // Observe protocol progress before SDK early-error lookahead can
            // buffer it. Only metadata crosses this diagnostic boundary.
            if (event && typeof event['type'] === 'string') {
              const result = event['response'] as Record<string, unknown> | undefined

              onStreamEvent?.({
                type: 'provider-event',
                providerEventType: event['type'],
                ...(event['type'] === 'response.in_progress' ? { requestAccepted: true } : {}),
                ...(event['type'] === 'response.completed' ? { providerCompleted: true } : {}),
                transport,
                ...(typeof result?.['id'] === 'string'
                  ? { responseId: result['id'] }
                  : {})
              })
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
                socket?.close()
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
