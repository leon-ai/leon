import { randomUUID } from 'node:crypto'

import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'
import { LogHelper } from '@/helpers/log-helper'
import type { InferenceMetadata } from '../inference-metadata'
import { InferencePurpose } from '../types'
import { readProviderUsage, type InferenceUsage } from './usage-context'
import { appendInferenceUsage } from './usage-ledger'

const MAXIMUM_USAGE_EVENT_CHARS = 1_048_576

/**
 * Accounts for tool-owned model requests through body consumption, including
 * cancellation. Bytes and backpressure stay with the caller; only counters persist.
 */
export async function trackProviderResponseUsage(
  inference: InferenceMetadata,
  dispatch: () => Promise<Response>,
  signal?: AbortSignal
): Promise<Response> {
  const profileName = getActiveProfileName()
  const sessionId = getActiveConversationSessionId() || null
  const startedAt = Date.now()
  const id = randomUUID()
  let usage: InferenceUsage = {}
  let outcome = 'failed'
  let canceled = false
  let terminalFailure = false
  let saved: Promise<void> | undefined
  const finish = (): Promise<void> => {
    if (!saved) {
      signal?.removeEventListener('abort', abort)

      saved = appendInferenceUsage(profileName, {
        id, startedAt, finishedAt: Date.now(), sessionId,
        provider: inference.provider, model: inference.model,
        purpose: InferencePurpose.ProviderTool, inference,
        outcome: canceled ? 'canceled' : outcome, usage
      }).catch((error) => {
        LogHelper.warning(`Could not save inference usage: ${String(error)}`)
      })
    }

    return saved
  }

  let response: Response

  try {
    response = await dispatch()
  } catch (error) {
    outcome = signal?.aborted ? 'canceled' : 'failed'
    await finish()
    throw error
  }

  if (!response.body) {
    outcome = response.ok ? 'completed' : 'failed'
    await finish()
    return response
  }

  const streaming = response.headers.get('content-type')?.includes('text/event-stream')
  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let pending = ''
  let data = ''
  let oversized = false
  const observe = (text: string): void => {
    if (text.trim() === '[DONE]') {
      outcome = response.ok && !terminalFailure ? 'completed' : 'failed'
      return
    }

    try {
      const event = JSON.parse(text)
      const result = event.response || event.message || event

      usage = { ...usage, ...readProviderUsage(result.usage) }

      if (!streaming || event.type === 'response.completed' || event.type === 'message_stop') {
        outcome = response.ok && !terminalFailure && !result.error && result.status !== 'failed' &&
          result.status !== 'incomplete' ? 'completed' : 'failed'
      } else if (event.type === 'error' || event.type === 'response.failed' ||
        event.type === 'response.incomplete') {
        terminalFailure = true
        outcome = 'failed'
      }
    } catch {
      // Diagnostics must not reject valid provider bytes or retain their content.
    }
  }
  const consume = (text: string): void => {
    const parts = text.split('\n')

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!

      // Large provider outputs still pass through unchanged. Skip oversized
      // accounting events rather than buffering media or inventing counters.
      if (pending.length + data.length + part.length > MAXIMUM_USAGE_EVENT_CHARS) {
        oversized = true
        pending = ''
        data = ''
      }
      if (!oversized) {
        pending += part
      }
      if (!streaming || index === parts.length - 1) {
        continue
      }

      const line = pending.trimEnd()
      pending = ''

      if (!line) {
        if (!oversized && data) {
          observe(data)
        }
        data = ''
        oversized = false
      } else if (line.startsWith('data:')) {
        data += `${data ? '\n' : ''}${line.slice('data:'.length).trimStart()}`
      }
    }
  }

  function abort(): void {
    canceled = true
    void reader.cancel(signal?.reason).catch(() => undefined).finally(finish)
  }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) {
    abort()
  }

  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      try {
        const { value, done } = await reader.read()

        if (done) {
          if (!saved) {
            consume(decoder.decode())
            if (streaming) {
              consume('\n\n')
            } else if (!oversized) {
              observe(pending)
            }
          }
          await finish()
          controller.close()
        } else {
          consume(decoder.decode(value, { stream: true }))
          controller.enqueue(value)
        }
      } catch (error) {
        outcome = signal?.aborted ? 'canceled' : 'failed'
        await finish()
        controller.error(error)
      }
    },
    async cancel(reason): Promise<void> {
      canceled = true

      try {
        await reader.cancel(reason)
      } finally {
        await finish()
      }
    }
  }, { highWaterMark: 0 }), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}
