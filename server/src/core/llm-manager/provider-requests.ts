import { randomUUID } from 'node:crypto'

import { CONFIG_MANAGER } from '@/config'
import { getModelAccountCredentials } from './llm-accounts'
import { getRequiredLLMProviderAccountConfig } from './llm-provider-account-configs'
import { OpenAIResponsesTransport } from './llm-providers/openai-responses-transport'
import { createProfileServiceProxy } from '@/core/profile-runtime/profile-runtime-manager'
import { createMediaProviderError } from './media-generation/media-generation-provider-error'
import { LLMProviders, type CompletionParams } from './types'
import { ProviderRequestActivity, attachProviderFailureDiagnostics } from './llm-provider/provider-request-activity'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { getLLMModelDefaultReasoning } from './llm-model-catalog'
import {
  CHATGPT_CODEX_BASE_URL,
  requireChatGPTCodexAccount
} from './llm-accounts/chatgpt-account-config'
import { requestChatGPTAccount } from './llm-accounts/chatgpt-account-request'
import { trackProviderResponseUsage } from './llm-usage/provider-response-usage'
import {
  createInferenceMetadata,
  InferenceAuthMode,
  InferenceCredentialSource
} from './inference-metadata'

const PROVIDER_REQUEST_TIMEOUT_MS = 600_000
const PROVIDER_CAPABILITY_HEADERS = ['anthropic-beta', 'anthropic-version']
const MODEL_USAGE_ENDPOINTS = new Set(['/responses', '/chat/completions', '/messages'])
const CHATGPT_API_ENDPOINTS = new Set([
  '/responses',
  '/images/generations',
  '/images/edits'
])

export interface ProviderConnection {
  baseURL: string
  apiKey: string
  accountId?: string
  chatModel?: string
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
  if (subscription) {
    requireChatGPTCodexAccount(credentials, String(credentials['account_id']))
  }
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
      ? CHATGPT_CODEX_BASE_URL
      : configuredBaseURL || (credentials
        ? String(credentials['base_url'] || defaultBaseURL || config.baseURL)
        : defaultBaseURL || CONFIG_MANAGER.getProviderBaseURL(provider) || config.baseURL),
    ...(subscription ? {
      accountId: String(credentials['account_id']),
      ...(typeof credentials['model'] === 'string' ? { chatModel: credentials['model'] } : {})
    } : {})
  }
}

/**
 * Collects a Responses stream while retaining built-in tool evidence and files.
 */
export async function readResponsesJSON(
  response: Response,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  if (!response.body) {
    throw new Error('The provider returned no response stream.')
  }

  signal?.throwIfAborted()

  const decoder = new TextDecoder()
  const outputItems = new Map<number, unknown>()
  let pending = ''
  let result: Record<string, unknown> | undefined
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
          const completed = event['response'] as Record<string, unknown>
          // Subscription streams deliver items separately and can leave the
          // terminal response's output empty. Keep native evidence and files.
          result = {
            ...completed,
            output: Array.isArray(completed['output']) && completed['output'].length
              ? completed['output']
              : [...outputItems.entries()]
                  .sort(([left], [right]) => left - right)
                  .map(([, item]) => item)
          }
        }
        if (event['type'] === 'error' || event['type'] === 'response.failed' ||
          event['type'] === 'response.incomplete') {
          const failed = event['response'] as Record<string, unknown> | undefined
          result = {
            ...failed,
            status: 'failed',
            error: failed?.['error'] || event['error'] || {
              code: event['code'] || event['type'],
              message: event['message'] || 'The provider did not complete the response.'
            }
          }
        }
      }
      boundary = pending.indexOf('\n')
    }
  }

  signal?.throwIfAborted()

  // Drain terminal bytes so usage and cancellation follow the stream's actual outcome.
  if (result) {
    return result
  }

  throw new Error('The provider stream ended before completing its response.')
}

/**
 * Reuses auxiliary Responses transport while preserving shared socket ordering.
 */
class ProviderRequests {
  private transport: OpenAIResponsesTransport | undefined
  private readonly subscriptionTransports = new Set<OpenAIResponsesTransport>()
  private binding = ''
  private tail: Promise<void> = Promise.resolve()

  /**
   * Retires the authenticated transport during shutdown or after a failed request.
   */
  public close(): void {
    this.transport?.close()
    for (const transport of this.subscriptionTransports) {
      transport.close()
    }
    this.subscriptionTransports.clear()
  }

  /**
   * Uses the profile transport for streamed or complete native provider responses.
   */
  public async responses(
    connection: ProviderConnection,
    body: Record<string, unknown>,
    signal: AbortSignal,
    onStreamEvent?: CompletionParams['onStreamEvent']
  ): Promise<Response> {
    // Subscription calls own independent sockets so concurrent generation never
    // falls back to HTTP merely because another call is still producing output.
    const previous = connection.accountId ? Promise.resolve() : this.tail
    let release: () => void = () => undefined

    if (!connection.accountId) {
      this.tail = new Promise<void>((resolve) => {
        release = resolve
      })
    }

    await previous
    const binding = JSON.stringify([connection.baseURL, connection.accountId])
    if (!connection.accountId && this.binding !== binding) {
      this.transport?.close()
      this.binding = binding
      this.transport = new OpenAIResponsesTransport(connection.baseURL, connection.accountId)
    }
    const transport = connection.accountId
      ? new OpenAIResponsesTransport(connection.baseURL, connection.accountId)
      : this.transport!

    if (connection.accountId) {
      this.subscriptionTransports.add(transport)
    }
    const abort = (): void => {
      transport.close()
    }
    signal.addEventListener('abort', abort, { once: true })
    let streaming = false
    const finish = (): void => {
      signal.removeEventListener('abort', abort)
      if (connection.accountId) {
        transport.close()
        this.subscriptionTransports.delete(transport)
      }
      release()
    }

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
      }, onStreamEvent)
      if (!response.ok) {
        return response
      }

      if (body['stream'] === true && response.body) {
        const reader = response.body.getReader()

        streaming = true

        // Keep the profile's transport reserved until its stream settles.
        return new Response(new ReadableStream<Uint8Array>({
          async pull(controller): Promise<void> {
            try {
              const { done, value } = await reader.read()

              if (done) {
                finish()
                controller.close()
              } else {
                controller.enqueue(value)
              }
            } catch (error) {
              transport.close()
              finish()
              controller.error(error)
            }
          },
          async cancel(reason): Promise<void> {
            try {
              await reader.cancel(reason)
            } finally {
              transport.close()
              finish()
            }
          }
        }), {
          status: response.status,
          headers: response.headers
        })
      }

      const data = await readResponsesJSON(response, signal)
      if (data['status'] === 'failed' || data['error']) {
        transport.close()
        return Response.json(data, { status: 502 })
      }

      return Response.json(data)
    } catch (error) {
      transport.close()
      throw error
    } finally {
      if (!streaming) {
        finish()
      }
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
  if (connection.accountId && !CHATGPT_API_ENDPOINTS.has(endpoint)) {
    throw new Error(`The ChatGPT subscription connection does not support ${endpoint}.`)
  }
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
  const requestURL = `${options.anthropicCompatibility
    ? new URL('/anthropic/v1', baseURL).href
    : baseURL}${endpoint}`
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
  if (connection.accountId && endpoint !== '/responses') {
    headers['x-codex-image-turn-id'] = randomUUID()
  }
  const activity = new ProviderRequestActivity()
  const observe: NonNullable<CompletionParams['onStreamEvent']> = (event) => activity.observe(event)
  const dispatch = async (accountHeaders?: Record<string, string>): Promise<Response> => {
    // Retain the fresh credential for redaction if a later provider response fails.
    Object.assign(headers, accountHeaders)
    signal.throwIfAborted()

    observe({ type: 'request-dispatched', transport: 'http' })
    const response = await fetch(requestURL, {
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
    observe({
      type: 'response-headers', transport: 'http',
      ...(response.headers.get('x-request-id') ? { requestId: response.headers.get('x-request-id')! } : {})
    })

    return response
  }
  const execute = async (): Promise<Response> => provider === LLMProviders.OpenAI && endpoint === '/responses' &&
    body && typeof body === 'object' && !(body instanceof FormData)
    ? await PROVIDER_REQUESTS.responses(
        { ...connection, baseURL }, body as Record<string, unknown>, signal, observe
      )
    : connection.accountId
      ? await requestChatGPTAccount(connection.accountId, dispatch)
      : await dispatch()
  const model = body && typeof body === 'object' && !(body instanceof FormData)
    ? (body as Record<string, unknown>)['model']
    : undefined
  const account = CONFIG_MANAGER.getProviderConfig(provider)?.account
  const response = MODEL_USAGE_ENDPOINTS.has(endpoint) && typeof model === 'string'
    ? await trackProviderResponseUsage(createInferenceMetadata({
        provider, model,
        authMode: connection.accountId ? InferenceAuthMode.ChatGPTOAuth : InferenceAuthMode.APIKey,
        credentialSource: account
          ? InferenceCredentialSource.AccountBinding
          : InferenceCredentialSource.ProfileAPIKey,
        ...(account ? { connectionId: account } : {}),
        privateValues: [connection.apiKey],
        endpoint: requestURL
      }), execute, signal, {
        activity,
        observeProtocolEvents: !(provider === LLMProviders.OpenAI && endpoint === '/responses')
      })
    : await execute()

  if (!response.ok) {
    const error = await createMediaProviderError(
      provider, response, [connection.apiKey, ...Object.values(headers)], body
    )
    attachProviderFailureDiagnostics(error, activity.snapshot(), signal.aborted)
    throw error
  }

  return response
}
