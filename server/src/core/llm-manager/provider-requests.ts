import { CONFIG_MANAGER } from '@/config'
import { getModelAccountCredentials } from './llm-accounts'
import { getRequiredLLMProviderAccountConfig } from './llm-provider-account-configs'
import { OpenAIResponsesTransport } from './llm-providers/openai-responses-transport'
import { createProfileServiceProxy } from '@/core/profile-runtime/profile-runtime-manager'
import { createMediaProviderError } from './media-generation/media-generation-provider-error'
import { LLMProviders } from './types'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { getLLMModelDefaultReasoning } from './llm-model-catalog'

const PROVIDER_REQUEST_TIMEOUT_MS = 600_000
const PROVIDER_CAPABILITY_HEADERS = ['anthropic-beta', 'anthropic-version']

export interface ProviderConnection {
  baseURL: string
  apiKey: string
  accountId?: string
}

/**
 * Reports a binding without treating a spare API key as the selected account.
 */
export function hasProviderConnection(provider: LLMProviders): boolean {
  return Boolean(
    CONFIG_MANAGER.getProviderConfig(provider)?.account ||
    CONFIG_MANAGER.getProviderAPIKey(provider)
  )
}

/**
 * Resolves credentials in the owning profile; a broken binding never falls back.
 */
export async function resolveProviderConnection(
  provider: LLMProviders,
  defaultBaseURL?: string,
  configuredBaseURL?: string
): Promise<ProviderConnection> {
  const config = getRequiredLLMProviderAccountConfig(provider)
  const credentials = await getModelAccountCredentials(provider)
  const subscription = credentials?.['auth_kind'] === 'chatgpt'
  const apiKey = credentials
    ? credentials['api_key'] || (subscription ? credentials['access_token'] : '')
    : CONFIG_MANAGER.getProviderAPIKey(provider)

  if (typeof apiKey !== 'string' || !apiKey) {
    throw new Error(
      `The selected ${provider} connection does not authorize provider API requests. Connect a compatible account or API key; another key will not be used automatically.`
    )
  }

  return {
    apiKey,
    baseURL: subscription
      ? config.baseURL
      : configuredBaseURL || (credentials
        ? String(credentials['base_url'] || defaultBaseURL || config.baseURL)
        : defaultBaseURL || CONFIG_MANAGER.getProviderBaseURL(provider) || config.baseURL),
    ...(subscription ? { accountId: String(credentials['account_id']) } : {})
  }
}

/**
 * Collects a Responses stream while retaining built-in tool evidence and files.
 */
async function readResponsesJSON(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) {
    throw new Error('The provider returned no response stream.')
  }

  const decoder = new TextDecoder()
  const outputItems = new Map<number, unknown>()
  let pending = ''
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true })
    let boundary = pending.indexOf('\n')
    while (boundary >= 0) {
      const line = pending.slice(0, boundary).trim()
      pending = pending.slice(boundary + 1)
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        const event = JSON.parse(line.slice('data: '.length)) as Record<string, unknown>
        if (event['type'] === 'response.output_item.done' &&
          typeof event['output_index'] === 'number') {
          outputItems.set(event['output_index'], event['item'])
        }
        if (event['type'] === 'response.completed') {
          const result = event['response'] as Record<string, unknown>
          // Subscription streams deliver items separately and can leave the
          // terminal response's output empty. Keep native evidence and files.
          return {
            ...result,
            output: Array.isArray(result['output']) && result['output'].length
              ? result['output']
              : [...outputItems.entries()]
                  .sort(([left], [right]) => left - right)
                  .map(([, item]) => item)
          }
        }
        if (event['type'] === 'error' || event['type'] === 'response.failed' ||
          event['type'] === 'response.incomplete') {
          const result = event['response'] as Record<string, unknown> | undefined
          return {
            status: 'failed',
            error: result?.['error'] || event['error'] || {
              code: event['code'] || event['type'],
              message: event['message'] || 'The provider did not complete the response.'
            }
          }
        }
      }
      boundary = pending.indexOf('\n')
    }
  }

  throw new Error('The provider stream ended before completing its response.')
}

/**
 * Serializes auxiliary Responses requests so a profile can reuse its connection.
 */
class ProviderRequests {
  private transport: OpenAIResponsesTransport | undefined
  private binding = ''
  private tail: Promise<void> = Promise.resolve()

  /**
   * Retires the authenticated transport during shutdown or after a failed request.
   */
  public close(): void {
    this.transport?.close()
  }

  /**
   * Uses the same transport as chat, returning a complete native provider response.
   */
  public async responses(
    connection: ProviderConnection,
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Response> {
    const previous = this.tail
    let release: () => void = () => undefined
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous
    const binding = JSON.stringify([connection.baseURL, connection.accountId])
    if (this.binding !== binding) {
      this.close()
      this.binding = binding
      this.transport = new OpenAIResponsesTransport(connection.baseURL, connection.accountId)
    }
    const transport = this.transport!
    const abort = (): void => {
      transport.close()
    }
    signal.addEventListener('abort', abort, { once: true })

    try {
      signal.throwIfAborted()
      const response = await transport.fetch(`${connection.baseURL}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${connection.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ ...body, stream: true }),
        signal,
        redirect: 'error'
      })
      if (!response.ok) {
        return response
      }
      const data = await readResponsesJSON(response)
      if (data['status'] === 'failed' || data['error']) {
        this.close()
        return Response.json(data, { status: 502 })
      }

      return Response.json(data)
    } catch (error) {
      this.close()
      throw error
    } finally {
      signal.removeEventListener('abort', abort)
      release()
    }
  }
}

export const PROVIDER_REQUESTS = createProfileServiceProxy(
  'provider-requests',
  () => new ProviderRequests()
)

/**
 * Sends native provider payloads with host-owned credentials and cancellation.
 */
export async function requestProvider(
  provider: LLMProviders,
  endpoint: string,
  body?: unknown,
  options: {
    connection?: ProviderConnection
    signal?: AbortSignal
    anthropicCompatibility?: boolean
    headers?: Record<string, string>
  } = {}
): Promise<Response> {
  if (!endpoint.startsWith('/') || endpoint.startsWith('//')) {
    throw new Error('Provider endpoints must be relative API paths.')
  }
  const connection = options.connection || await resolveProviderConnection(provider)
  if (provider === LLMProviders.OpenAI && endpoint === '/responses' &&
    body && typeof body === 'object' && !(body instanceof FormData)) {
    const payload = { ...body } as Record<string, unknown>
    const model = payload['model']
    if (typeof model === 'string') {
      const settings = CONFIG_STATE.getModelSettingsState().getSettings({
        provider,
        model,
        label: `${provider}/${model}`,
        isLocal: false,
        isEnabled: true,
        isResolved: true
      })
      const effort = settings.reasoning === 'auto'
        ? getLLMModelDefaultReasoning(provider, model).effort
        : settings.reasoning === 'on' ? undefined : settings.reasoning
      if (!payload['reasoning'] && effort) {
        payload['reasoning'] = { effort }
      }
      if (!payload['service_tier'] && settings.speed !== 'auto') {
        payload['service_tier'] = settings.speed === 'fast' ? 'priority' : 'default'
      }
    }
    payload['prompt_cache_key'] ??= 'leon-provider-tools'
    body = payload
  }
  const timeout = AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const baseURL = connection.baseURL.endsWith('/')
    ? connection.baseURL.slice(0, -1)
    : connection.baseURL
  const anthropic = provider === LLMProviders.Anthropic || options.anthropicCompatibility
  const headers: Record<string, string> = anthropic
    ? { 'x-api-key': connection.apiKey, 'anthropic-version': '2023-06-01' }
    : connection.apiKey ? { authorization: `Bearer ${connection.apiKey}` } : {}
  const capabilityHeaders = new Headers(options.headers)
  for (const name of PROVIDER_CAPABILITY_HEADERS) {
    const value = capabilityHeaders.get(name)
    if (value) {
      headers[name] = value
    }
  }
  const response = provider === LLMProviders.OpenAI && endpoint === '/responses' &&
    body && typeof body === 'object' && !(body instanceof FormData)
    ? await PROVIDER_REQUESTS.responses(
        { ...connection, baseURL }, body as Record<string, unknown>, signal
      )
    : await fetch(`${options.anthropicCompatibility
      ? new URL('/anthropic/v1', baseURL).href
      : baseURL}${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...headers,
          ...(body === undefined || body instanceof FormData
            ? {}
            : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : {
          body: body instanceof FormData ? body : JSON.stringify(body)
        }),
        signal,
        redirect: 'error'
      })

  if (!response.ok) {
    throw await createMediaProviderError(
      provider, response, [connection.apiKey, ...Object.values(headers)], body
    )
  }

  return response
}
