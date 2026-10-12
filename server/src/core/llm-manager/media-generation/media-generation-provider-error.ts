import { StringHelper } from '@/helpers/string-helper'
import type { LLMProviders } from '@/core/llm-manager/types'

const MAX_ERROR_BODY_BYTES = 16 * 1_024
const MAX_ERROR_FIELD_CHARS = 1_024
const REDACTED = '[REDACTED]'
const ERROR_FIELDS = ['message', 'code', 'type', 'param'] as const
const REQUEST_ID_HEADERS = ['x-request-id', 'request-id'] as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function readErrorBody(
  response: Response
): Promise<Record<string, unknown>> {
  if (!response.body) {
    return {}
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0

  try {
    // Do not buffer arbitrary proxy pages or unbounded diagnostic payloads.
    for (;;) {
      const { value, done } = await reader.read()

      if (done) {
        break
      }

      length += value.length
      if (length > MAX_ERROR_BODY_BYTES) {
        return {}
      }

      chunks.push(value)
    }

    return record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch {
    return {}
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

/**
 * Preserves actionable provider diagnostics without forwarding raw response bodies,
 * nested metadata, submitted prompts or credentials into conversation/tool logs.
 */
export async function createMediaProviderError(
  provider: LLMProviders,
  response: Response,
  secrets: string[],
  requestBody?: unknown
): Promise<Error> {
  const body = await readErrorBody(response)
  const error = record(body['error'])
  const request = record(requestBody)
  const privateValues = [...secrets, request['prompt'], request['input']]
    .filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    )
    .sort((a, b) => b.length - a.length)
  const sanitize = (value: unknown): string => {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return ''
    }

    let text = String(value)

    // Replace exact credentials before truncation, including short/nonstandard keys.
    for (const secret of privateValues) {
      text = text.split(secret).join(REDACTED)
    }

    text = StringHelper.redactSecrets(text)

    return text.slice(0, MAX_ERROR_FIELD_CHARS)
  }
  const details: string[] = []

  for (const field of ERROR_FIELDS) {
    const value = sanitize(
      error[field] ??
        body[field] ??
        (field === 'message' && typeof body['error'] === 'string'
          ? body['error']
          : undefined)
    )

    if (value) {
      details.push(`${field}: ${value}`)
    }
  }

  const requestId = sanitize(
    body['request_id'] ??
      error['request_id'] ??
      REQUEST_ID_HEADERS.map((header) => response.headers.get(header)).find(
        Boolean
      )
  )

  if (requestId) {
    details.push(`request_id: ${requestId}`)
  }

  return new Error(
    `${provider} generation request failed (${response.status}).${details.length ? ` ${details.join('; ')}` : ''}`
  )
}
