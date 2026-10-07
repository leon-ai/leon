import { MAX_GENERATED_ARTIFACT_BYTES } from '@/constants'

import { CONFIG_MANAGER } from '@/config'
import { LLMProviders } from '@/core/llm-manager/types'
import { MEDIA_PROVIDERS } from './media-generation-catalog'
import { requestProvider, resolveProviderConnection, type ProviderConnection } from '../provider-requests'

const REQUEST_TIMEOUT_MS = 600_000

/**
 * Reuses profile credentials, with no secrets in results or provider error bodies.
 */
export async function mediaEndpoint(provider: LLMProviders): Promise<ProviderConnection> {
  const config = MEDIA_PROVIDERS[provider]

  if (!config) {
    throw new Error(`Provider ${provider} does not expose media generation.`)
  }

  const configuredBaseURL = CONFIG_MANAGER.getProviderGenerationBaseURL(provider)
  if (provider === LLMProviders.SGLang) {
    const base = configuredBaseURL || config.base_url
    if (!base) {
      throw new Error('Configure the media runtime endpoint first.')
    }

    return { baseURL: base, apiKey: '' }
  }

  const connection = await resolveProviderConnection(
    provider,
    provider === LLMProviders.MiniMax ? undefined : config.base_url,
    configuredBaseURL
  )

  // Normalize the selected connection, never an older profile chat endpoint.
  if (provider === LLMProviders.MiniMax && connection.baseURL.endsWith('/anthropic')) {
    connection.baseURL = connection.baseURL.slice(0, -'/anthropic'.length) + '/v1'
  }

  return connection
}

/**
 * Executes one request without retrying billable generation submissions.
 * Reuses a resolved connection when payload formatting depends on its auth method.
 */
export async function providerRequest(
  provider: LLMProviders,
  endpoint: string,
  body?: unknown,
  signal?: AbortSignal,
  connection?: ProviderConnection
): Promise<Response> {
  const selectedConnection = connection || await mediaEndpoint(provider)

  return requestProvider(provider, endpoint, body, {
    connection: selectedConnection,
    ...(signal ? { signal } : {})
  })
}

/**
 * Bounds binary downloads even when Content-Length is absent or inaccurate.
 */
export async function readMediaBytes(response: Response): Promise<Uint8Array> {
  if (!response.ok || !response.body) {
    throw new Error('Generated file download failed.')
  }

  if (
    Number(response.headers.get('content-length')) >
    MAX_GENERATED_ARTIFACT_BYTES
  ) {
    throw new Error('Generated file is too large.')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    for (;;) {
      const { value, done } = await reader.read()

      if (done) {
        break
      }

      size += value.length
      if (size > MAX_GENERATED_ARTIFACT_BYTES) {
        throw new Error('Generated file is too large.')
      }

      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }

  return Buffer.concat(chunks)
}

/**
 * Provider-supplied signed URLs are downloaded without forwarding API credentials.
 */
export async function downloadGeneratedFile(
  url: string,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const target = new URL(url)

  if (target.protocol !== 'https:') {
    throw new Error('Generated file URL must use HTTPS.')
  }

  return readMediaBytes(
    await fetch(target, {
      redirect: 'error',
      signal: signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  )
}
