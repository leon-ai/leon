import { createWebSocketFetch } from '@vercel/ai-sdk-openai-websocket-fetch'
import { requestChatGPTAccount } from '../llm-accounts/chatgpt-account-request'

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
const OPENAI_UNCLOSED_TERMINAL_EVENTS = new Set([
  'response.failed',
  'response.incomplete'
])

/**
 * Shares authenticated Responses transport between inference and auxiliary requests.
 */
export class OpenAIResponsesTransport {
  private openAIWebSocketFetch: ReturnType<typeof createWebSocketFetch> | undefined
  private openAIWebSocketAuthorization: string | undefined

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
    init?: RequestInit
  ): Promise<Response> {
    return this.accountId
      ? this.fetchChatGPT(input, init)
      : this.fetchOpenAI(input, init)
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
    init?: RequestInit
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

    return requestChatGPTAccount(String(this.accountId), async (accountHeaders) => {
      const headers = new Headers(init?.headers)
      for (const [name, value] of Object.entries(accountHeaders)) {
        headers.set(name, value)
      }

      // The WebSocket adapter drops custom headers. Codex needs its workspace
      // header on the handshake, so use its native HTTP/SSE transport here.
      init?.signal?.throwIfAborted()
      this.onDispatch?.(String(input))

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
    init?: RequestInit
  ): Promise<Response> {
    init?.signal?.throwIfAborted()
    const authorization = new Headers(init?.headers).get('authorization') || ''
    if (this.openAIWebSocketAuthorization !== authorization) {
      this.openAIWebSocketFetch?.close()
      this.openAIWebSocketFetch = undefined
      this.openAIWebSocketAuthorization = authorization
    }

    const transport = this.getOpenAIWebSocketFetch()
    try {
      this.onDispatch?.(this.toOpenAIResponsesWebSocketURL(this.baseURL))
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

      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        return response
      }

      // The adapter emits one SSE chunk per WebSocket message, but leaves
      // failed/incomplete responses open. Forward their usage before closing.
      const decoder = new TextDecoder()
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller): void => {
          controller.enqueue(chunk)
          const line = decoder.decode(chunk).trim()
          if (!line.startsWith('data: ') || line === 'data: [DONE]') {
            return
          }
          let event: Record<string, unknown>
          try {
            event = JSON.parse(line.slice('data: '.length)) as Record<string, unknown>
          } catch {
            return
          }
          if (OPENAI_UNCLOSED_TERMINAL_EVENTS.has(String(event['type']))) {
            this.close()
            controller.terminate()
          }
        }
      }))

      return new Response(body, { status: response.status, headers: response.headers })
    } catch (error) {
      // A rejected handshake or canceled opening must not leave reusable state.
      transport.close()
      if (this.openAIWebSocketFetch === transport) {
        this.openAIWebSocketFetch = undefined
      }
      throw error
    }
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
