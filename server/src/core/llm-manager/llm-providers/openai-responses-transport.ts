import { createWebSocketFetch } from '@vercel/ai-sdk-openai-websocket-fetch'

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
const CHATGPT_TOOL_NAMESPACE = 'leon'
const OPENAI_UNCLOSED_TERMINAL_EVENTS = new Set([
  'response.failed',
  'response.incomplete'
])
// The transport exposes rejected upgrade status only through ws's error message.
const OPENAI_WEBSOCKET_AUTH_ERRORS = new Map([
  ['Unexpected server response: 401', 401],
  ['Unexpected server response: 403', 403]
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
    const { MODEL_ACCOUNT_STORE } = await import('@/core/llm-manager/llm-accounts')
    const id = String(this.accountId || '')
    const credentials = await MODEL_ACCOUNT_STORE.getCredentials(id)
    if (!credentials?.['access_token']) {
      throw new Error('Please reconnect your ChatGPT account with /connection ai connect openai.')
    }

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
    // SIWC accepts developer instructions, while explicit system messages are rejected.
    const items = Array.isArray(body['input'])
      ? body['input'] as Record<string, unknown>[]
      : typeof body['input'] === 'string'
        ? [{ role: 'user', content: body['input'] }]
        : []
    body['input'] = items.map((item) => {
      if (item['role'] === 'system') {
        return { ...item, role: 'developer' }
      }
      // Review turns may replay calls after their function schemas are removed.
      if (item['type'] === 'function_call') {
        return { ...item, namespace: item['namespace'] || CHATGPT_TOOL_NAMESPACE }
      }

      return item
    })
    const tools = Array.isArray(body['tools']) ? body['tools'] : []
    const functions = tools.filter((tool) => tool['type'] === 'function')
    if (functions.length) {
      // Plan usage requires function tools in a namespace; Core still executes them.
      body['tools'] = [...tools.filter((tool) => tool['type'] !== 'function'), {
        type: 'namespace',
        name: CHATGPT_TOOL_NAMESPACE,
        description: 'Leon tools',
        tools: functions
      }]
      const choice = body['tool_choice'] as Record<string, unknown> | undefined
      if (choice?.['type'] === 'function') {
        choice['namespace'] = CHATGPT_TOOL_NAMESPACE
      }
    }

    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${String(credentials['access_token'])}`)

    const request = {
      ...init,
      headers,
      body: JSON.stringify(body),
      redirect: 'error' as const
    }
    try {
      return await this.fetchOpenAI(input, request)
    } catch (error) {
      const status = this.getOpenAIAuthenticationStatus(error)
      if (status !== 401 && status !== 403) {
        throw error
      }

      if (status === 401) {
        // Retry authorization once before generation; never switch accounts.
        const refreshed = await MODEL_ACCOUNT_STORE
          .getCredentials(id, undefined, true)
          .catch(() => null)
        if (refreshed?.['access_token']) {
          const refreshedHeaders = new Headers(headers)
          refreshedHeaders.set(
            'authorization',
            `Bearer ${String(refreshed['access_token'])}`
          )

          try {
            return await this.fetchOpenAI(input, {
              ...request,
              headers: refreshedHeaders
            })
          } catch (retryError) {
            if (!this.getOpenAIAuthenticationStatus(retryError)) {
              throw retryError
            }
          }
        }
      }

      await MODEL_ACCOUNT_STORE.markNeedsAttention(id)
      throw new Error(`I need you to reconnect this account with /connection ai connect ${id}.`)
    }
  }

  /**
   * Uses one OpenAI transport for keys and accounts, rotating authenticated sockets.
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

  /**
   * Recognizes authentication rejection without treating transport failures as revocation.
   */
  private getOpenAIAuthenticationStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined
    }

    const details = error as Record<string, unknown>
    const status = details['statusCode'] ?? details['status']
    if (status === 401 || status === 403) {
      return status
    }

    return typeof details['message'] === 'string'
      ? OPENAI_WEBSOCKET_AUTH_ERRORS.get(details['message'])
      : undefined
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
