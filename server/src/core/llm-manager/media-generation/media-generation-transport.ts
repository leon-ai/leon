import { MAX_GENERATED_ARTIFACT_BYTES } from '@/constants'

import { CONFIG_MANAGER } from '@/config'
import { LLMProviders } from '@/core/llm-manager/types'
import { MEDIA_PROVIDERS } from './media-generation-catalog'
import { createMediaProviderError } from './media-generation-provider-error'

const REQUEST_TIMEOUT_MS = 600_000

/**
 * Reuses profile credentials, with no secrets in results or provider error bodies.
 */
export function mediaEndpoint(provider: LLMProviders): {
  base: string
  headers: Record<string, string>
} {
  const config = MEDIA_PROVIDERS[provider]

  if (!config) {
    throw new Error(`Provider ${provider} does not expose media generation.`)
  }

  const key = CONFIG_MANAGER.getProviderAPIKey(provider)

  if (!key && provider !== LLMProviders.SGLang) {
    throw new Error(`Configure the ${provider} API key first.`)
  }

  let base =
    CONFIG_MANAGER.getProviderGenerationBaseURL(provider) ||
    (provider === LLMProviders.MiniMax
      ? CONFIG_MANAGER.getProviderBaseURL(provider)
      : '') ||
    config.base_url

  // MiniMax exposes a separate Anthropic-compatible chat path on the same API host.
  if (provider === LLMProviders.MiniMax && base.endsWith('/anthropic')) {
    base = base.slice(0, -'/anthropic'.length) + '/v1'
  }

  if (!base) {
    throw new Error('Configure the media runtime endpoint first.')
  }

  return {
    base: base.replace(/\/$/, ''),
    headers:
      provider === LLMProviders.Anthropic
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : key
          ? { Authorization: `Bearer ${key}` }
          : {}
  }
}

/**
 * Executes one request without retrying billable generation submissions.
 */
export async function providerRequest(
  provider: LLMProviders,
  endpoint: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<Response> {
  const { base, headers } = mediaEndpoint(provider)
  const response = await fetch(`${base}${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...headers,
      ...(body === undefined || body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error'
  })

  if (!response.ok) {
    throw await createMediaProviderError(
      provider,
      response,
      [CONFIG_MANAGER.getProviderAPIKey(provider), ...Object.values(headers)],
      body
    )
  }

  return response
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
