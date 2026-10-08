import { inspect } from 'node:util'

import axios from 'axios'

import { BRAIN } from '@/core'
import { STREAM_IDLE_TIMEOUT_ERROR_NAME } from '@/core/llm-manager/llm-provider/llm-provider-constants'
import { withOmittedToolChoice } from '@/core/llm-manager/llm-provider/llm-provider-request'
import type {
  PreparedCompletionParams,
  PromptAbortError
} from '@/core/llm-manager/llm-provider/llm-provider-types'
import {
  LLMProviders,
  type CompletionParams,
  type LLMPromptAbortReason
} from '@/core/llm-manager/types'
import { LogHelper } from '@/helpers/log-helper'

const MAX_LOG_SERIALIZED_LENGTH = 4_000

const RETRYABLE_ERROR_RETRY_DELAY_MS = 1_250

const REMOTE_PROVIDER_ERROR_RETRY_DELAY_MS = 5_000

const CONNECTION_ERROR_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ERR_NETWORK'
])

const TIMEOUT_RETRY_INCREMENT_MS = 30_000

/**
 * Serialize diagnostic values with a fallback for circular objects.
 */
export function safeSerialize(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value === null || value === undefined) {
    return ''
  }

  try {
    return JSON.stringify(value)
  } catch {
    try {
      return inspect(value, {
        depth: 3,
        breakLength: 120,
        maxArrayLength: 30
      })
    } catch {
      return String(value)
    }
  }
}

/**
 * Bound diagnostic payloads before writing them to logs.
 */
export function truncateForLog(input: string): string {
  if (input.length <= MAX_LOG_SERIALIZED_LENGTH) {
    return input
  }

  return `${input.slice(0, MAX_LOG_SERIALIZED_LENGTH)}... [truncated]`
}

/**
 * Recognize transient provider and transport failures.
 */
function isRetryablePromptError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (typeof status === 'number') {
      return status >= 500 || status === 408 || status === 429
    }

    const code = (error.code || '').toUpperCase()
    if (
      code === 'ECONNABORTED' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'EAI_AGAIN' ||
      code === 'ENOTFOUND' ||
      code === 'ERR_NETWORK'
    ) {
      return true
    }

    return !error.response
  }

  const errorObject =
    error && typeof error === 'object'
      ? (error as { message?: unknown, name?: unknown, status?: unknown })
      : null
  const status =
    errorObject && typeof errorObject.status === 'number'
      ? errorObject.status
      : null
  if (status !== null) {
    return status >= 500 || status === 408 || status === 429
  }

  const name = String(errorObject?.name ?? '').toLowerCase()
  const message = String(errorObject?.message ?? error ?? '').toLowerCase()
  const combined = `${name} ${message}`

  return (
    combined.includes('connectionerror') ||
    combined.includes('fetch failed') ||
    combined.includes('network error') ||
    combined.includes('socket hang up') ||
    combined.includes('econnreset') ||
    combined.includes('etimedout') ||
    combined.includes('timed out') ||
    combined.includes('timeout') ||
    combined.includes('request timeout') ||
    combined.includes('deadline exceeded') ||
    combined.includes('eai_again') ||
    combined.includes('enotfound') ||
    combined.includes('provider overloaded')
  )
}

/**
 * Read transport error codes through SDK wrappers and aggregate dial errors.
 */
export function getConnectionErrorCode(error: unknown): string | undefined {
  const pending: unknown[] = [error]
  const visited = new Set<object>()

  while (pending.length > 0) {
    const current = pending.pop()

    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue
    }

    visited.add(current)

    const details = current as Record<string, unknown>
    const code = details['code']

    // ETIMEDOUT also describes read timeouts; only classify an explicit dial.
    if (typeof code === 'string' && (
      CONNECTION_ERROR_CODES.has(code) ||
      (code === 'ETIMEDOUT' && details['syscall'] === 'connect')
    )) {
      return code
    }

    pending.push(details['cause'])

    if (current instanceof AggregateError) {
      pending.push(...current.errors)
    }
  }

  return undefined
}

/**
 * Separate inference deadlines from failures to establish a connection.
 */
export function isTimeoutLikeError(error: unknown): boolean {
  if (getConnectionErrorCode(error)) {
    return false
  }

  const promptAbortReason = getPromptAbortReason(error)
  if (promptAbortReason?.retryStrategy === 'timeout') {
    return true
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    if (status === 408 || status === 504) {
      return true
    }

    const code = (error.code || '').toUpperCase()
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return true
    }
  }

  const errorObject =
    error && typeof error === 'object'
      ? (error as { message?: unknown, name?: unknown, cause?: unknown })
      : null

  const combined = `${String(errorObject?.name ?? '')} ${String(
    errorObject?.message ?? error ?? ''
  )} ${String(errorObject?.cause ?? '')}`.toLowerCase()

  return (
    combined.includes('timeout (') ||
    combined.includes('timed out') ||
    combined.includes('timeout') ||
    combined.includes('request timeout') ||
    combined.includes('deadline exceeded')
  )
}

/**
 * Wait for the configured retry backoff.
 */
export function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

/**
 * Recognize provider rejections of forced tools with thinking enabled.
 */
function isThinkingToolChoiceConflictError(error: unknown): boolean {
  const message = String(error ?? '').toLowerCase()
  return (
    message.includes('tool_choice') &&
    message.includes('thinking') &&
    (message.includes('incompatible') || message.includes('not supported'))
  )
}

/**
 * Recognize provider rejections of the tool-choice parameter.
 */
function isUnsupportedToolChoiceError(error: unknown): boolean {
  const message = String(error ?? '').toLowerCase()

  if (!message.includes('tool_choice')) {
    return false
  }

  return (
    message.includes('no endpoints found') ||
    message.includes('support the provided') ||
    message.includes('unsupported value') ||
    message.includes('invalid value') ||
    message.includes('not supported')
  )
}

/**
 * Preserve useful provider error details within the log size limit.
 */
export function buildProviderErrorDetails(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const data = error.response?.data
    return truncateForLog(
      safeSerialize({
        name: error.name,
        message: error.message,
        ...(typeof status === 'number' ? { status } : {}),
        ...(data !== undefined ? { data } : {})
      })
    )
  }

  const errorObject =
    error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : null

  if (!errorObject) {
    return truncateForLog(String(error))
  }

  const details: Record<string, unknown> = {
    name:
      typeof errorObject['name'] === 'string'
        ? (errorObject['name'] as string)
        : 'Error',
    message:
      typeof errorObject['message'] === 'string'
        ? (errorObject['message'] as string)
        : String(error)
  }

  if (typeof errorObject['status'] === 'number') {
    details['status'] = errorObject['status'] as number
  }
  if (typeof errorObject['statusCode'] === 'number') {
    details['statusCode'] = errorObject['statusCode'] as number
  }
  if (errorObject['body'] !== undefined) {
    details['body'] = errorObject['body']
  }
  if (errorObject['error'] !== undefined) {
    details['error'] = errorObject['error']
  }
  if (errorObject['cause'] !== undefined) {
    details['cause'] = errorObject['cause']
  }

  return truncateForLog(safeSerialize(details))
}

/**
 * Format a provider failure for the existing diagnostic log.
 */
export function formatPromptErrorForLog(error: unknown): string {
  const errorObject =
    error && typeof error === 'object'
      ? (error as { message?: unknown, name?: unknown })
      : null
  const message =
    typeof errorObject?.message === 'string'
      ? errorObject.message
      : String(error)
  const name =
    typeof errorObject?.name === 'string' ? errorObject.name : 'Error'

  if (message && message !== '[object Object]') {
    return `${name}: ${message}`
  }

  const details = buildProviderErrorDetails(error)
  return details || String(error)
}

/**
 * Recognize structured abort instructions from the agent loop.
 */
export function isPromptAbortReason(value: unknown): value is LLMPromptAbortReason {
  if (!value || typeof value !== 'object') {
    return false
  }

  const reason = value as Record<string, unknown>
  return (
    reason['shouldRetry'] === true &&
    reason['retryStrategy'] === 'timeout' &&
    reason['source'] === 'agent_tool_call_diagnosis' &&
    typeof reason['delayMs'] === 'number'
  )
}

/**
 * Read retry instructions attached to an attempt-level abort.
 */
function getPromptAbortReason(error: unknown): LLMPromptAbortReason | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const promptAbortReason = (error as PromptAbortError).promptAbortReason
  return isPromptAbortReason(promptAbortReason)
    ? promptAbortReason
    : null
}

/**
 * Preserve structured retry instructions when wrapping an abort as an error.
 */
export function createPromptAbortError(reason: LLMPromptAbortReason): PromptAbortError {
  const error = new Error(
    `Prompt aborted by caller after ${reason.delayMs}ms grace period`
  ) as PromptAbortError
  error.name = 'LLMPromptAbortError'
  error.promptAbortReason = reason

  return error
}

/**
 * Remove an aborted attempt signal before retrying the owner request.
 */
function omitCompletionSignal(
  completionParams: CompletionParams
): Omit<CompletionParams, 'signal'> {
  const { signal, ...retryParams } = completionParams
  void signal

  return retryParams
}

/**
 * Build the existing localized provider failure message.
 */
export function buildProviderErrorMessage(
  providerName: LLMProviders,
  error: string,
  details = '',
  isRemoteProvider = false
): string {
  return BRAIN.wernicke(
    isRemoteProvider
      ? 'llm_remote_provider_error'
      : 'llm_provider_http_error',
    '',
    {
      '{{ provider }}': providerName,
      '{{ error }}': error,
      '{{ api_error }}': details ? `\n${details}` : ''
    }
  )
}

/**
 * Select the next request and wait for the existing retry backoff, if allowed.
 */
export async function prepareCompletionRetry(
  e: unknown,
  completionParams: PreparedCompletionParams,
  isRemoteProvider: boolean,
  abortController: AbortController
): Promise<CompletionParams | null> {
  const connectionErrorCode = getConnectionErrorCode(e)
  const isTimeoutError = isTimeoutLikeError(e)
  const isRetryableNonTimeoutError = isRetryablePromptError(e)
  const isThinkingToolChoiceConflict =
    isThinkingToolChoiceConflictError(e)
  const isUnsupportedToolChoice = isUnsupportedToolChoiceError(e)
  const promptAbortReason = getPromptAbortReason(e)
  const remainingRetries = completionParams.maxRetries ?? 0
  const remainingRemoteProviderErrorRetries =
    completionParams.remoteProviderErrorRetries ?? 0

  const hasForcedToolChoice =
    Array.isArray(completionParams.tools) &&
    completionParams.tools.length > 0 &&
    completionParams.toolChoice !== undefined &&
    completionParams.toolChoice !== 'auto'

  if (
    isThinkingToolChoiceConflict &&
    hasForcedToolChoice &&
    !completionParams.relaxForcedToolChoice &&
    remainingRetries > 0
  ) {
    if (completionParams.disableThinking !== true) {
      LogHelper.title('LLM Provider')
      LogHelper.warning(
        'Provider rejected forced tool_choice with thinking enabled; retrying with thinking disabled while keeping tool_choice'
      )

      return {
        ...completionParams,
        disableThinking: true,
        maxRetries: remainingRetries - 1
      }
    }

    LogHelper.title('LLM Provider')
    LogHelper.warning(
      'Provider rejected forced tool_choice with thinking enabled; retrying without tool_choice'
    )

    const retryParams = withOmittedToolChoice(completionParams)
    return {
      ...retryParams,
      relaxForcedToolChoice: true,
      maxRetries: remainingRetries - 1
    }
  }

  if (
    isUnsupportedToolChoice &&
    hasForcedToolChoice &&
    !completionParams.relaxForcedToolChoice &&
    remainingRetries > 0
  ) {
    LogHelper.title('LLM Provider')
    LogHelper.warning(
      'Provider rejected forced tool_choice; retrying without tool_choice for compatibility'
    )

    const retryParams = withOmittedToolChoice(completionParams)
    return {
      ...retryParams,
      relaxForcedToolChoice: true,
      maxRetries: remainingRetries - 1
    }
  }

  if (
    !isTimeoutError &&
    isRemoteProvider &&
    remainingRemoteProviderErrorRetries > 0
  ) {
    if (!abortController.signal.aborted) {
      abortController.abort()
    }

    await waitForRetry(REMOTE_PROVIDER_ERROR_RETRY_DELAY_MS)

    LogHelper.title('LLM Provider')
    LogHelper.warning(
      connectionErrorCode
        ? `Provider connection failed (${connectionErrorCode}); retrying after ${REMOTE_PROVIDER_ERROR_RETRY_DELAY_MS}ms without increasing the inference timeout (${remainingRemoteProviderErrorRetries} retry left)`
        : `Remote provider failed; retrying after ${REMOTE_PROVIDER_ERROR_RETRY_DELAY_MS}ms (${remainingRemoteProviderErrorRetries} retry left)`
    )

    return {
      ...completionParams,
      remoteProviderErrorRetries: remainingRemoteProviderErrorRetries - 1
    }
  }

  if (
    (isTimeoutError || (!isRemoteProvider && isRetryableNonTimeoutError)) &&
    remainingRetries > 0
  ) {
    if (!abortController.signal.aborted) {
      abortController.abort()
    }

    const isStreamIdleTimeout = e instanceof Error &&
      e.name === STREAM_IDLE_TIMEOUT_ERROR_NAME
    const nextTimeout = isTimeoutError && !isStreamIdleTimeout
      ? (completionParams.timeout ?? 0) + TIMEOUT_RETRY_INCREMENT_MS
      : completionParams.timeout
    const retryParams = promptAbortReason?.shouldRetry
      ? omitCompletionSignal(completionParams)
      : completionParams

    if (!isTimeoutError) {
      await waitForRetry(RETRYABLE_ERROR_RETRY_DELAY_MS)
    }

    LogHelper.title('LLM Provider')
    LogHelper.warning(
      isTimeoutError
        ? `Prompt timed out. Previous inference canceled; retrying with timeout=${nextTimeout}ms (${remainingRetries} retry left)`
        : `Prompt failed with a retryable provider/network error; retrying (${remainingRetries} retry left)`
    )

    return {
      ...retryParams,
      timeout: nextTimeout,
      maxRetries: remainingRetries - 1
    }
  }

  return null
}
