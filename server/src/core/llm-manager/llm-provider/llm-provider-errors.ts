import { inspect } from 'node:util'

import axios from 'axios'

import { BRAIN } from '@/core'
import { withOmittedToolChoice } from '@/core/llm-manager/llm-provider/llm-provider-request'
import type {
  PreparedCompletionParams,
  PromptAbortError
} from '@/core/llm-manager/llm-provider/llm-provider-types'
import {
  LLMProviders,
  LLMDuties,
  CompletionFailureKind,
  ProviderRetryDecision,
  ProviderRetryReason,
  type CompletionParams,
  type LLMPromptAbortReason
} from '@/core/llm-manager/types'
import { StringHelper } from '@/helpers/string-helper'
import { getConnectionErrorCode } from './provider-request-activity'

export { getConnectionErrorCode, attachProviderFailureDiagnostics } from './provider-request-activity'

const MAX_LOG_SERIALIZED_LENGTH = 4_000
const MAX_ERROR_CAUSE_DEPTH = 5
const ERROR_DIAGNOSTIC_FIELDS = [
  'name', 'message', 'code', 'type', 'param', 'status', 'statusCode',
  'closeCode', 'closeReason', 'transportPhase', 'handshakeDurationMs',
  'requestBytes', 'maximumRequestBytes', 'uploadDurationMs', 'uploadElapsedMs',
  'requestId', 'responseId', 'providerRequestId', 'elapsedMs', 'requestAcceptedMs',
  'firstProviderEventMs', 'lastProviderEvent', 'lastProviderEventMs',
  'providerIdleMs', 'providerEventCount', 'providerCompleted', 'failureSummary',
  'firstOutputMs', 'outputPreliminary', 'retryDecision', 'retryReason',
  'pingCount', 'pongCount', 'lastPingAgeMs', 'lastPongAgeMs', 'lastPongRttMs'
] as const
const ERROR_CAUSE_FIELDS = ['cause', 'error', 'data', 'response'] as const

const RETRYABLE_ERROR_RETRY_DELAY_MS = 1_250

const REMOTE_PROVIDER_ERROR_RETRY_DELAY_MS = 5_000

const MAX_TRANSIENT_FAILURE_RETRY_ELAPSED_MS = 15_000
const MAX_PROVIDER_CONNECTION_RETRIES = 5
const CONTEXT_ERROR_CODES = new Set([
  'context_length_exceeded',
  'context_window_exceeded',
  'prompt_too_long'
])
const COMPACTION_PARAMETER = 'context_management'

/**
 * Recognizes payload limits through SDK wrappers and transport causes.
 */
function isRequestSizeError(error: unknown): boolean {
  const pending: unknown[] = [error]
  const visited = new Set<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue
    }

    visited.add(current)
    const details = current as Record<string, unknown>
    if (details['statusCode'] === 413 || details['status'] === 413 ||
      details['closeCode'] === 1_009) {
      return true
    }

    pending.push(details['cause'], details['error'], details['data'], details['response'])
    if (current instanceof AggregateError) {
      pending.push(...current.errors)
    }
  }

  return false
}

/**
 * Preserve structured provider failures so recovery does not confuse availability with context.
 */
export function getCompletionFailureKind(error: unknown): CompletionFailureKind {
  if (isRequestSizeError(error)) {
    return CompletionFailureKind.Context
  }
  if (getConnectionErrorCode(error)) {
    return CompletionFailureKind.Connection
  }
  if (isTimeoutLikeError(error)) {
    return CompletionFailureKind.Timeout
  }

  const pending: unknown[] = [error]
  const visited = new Set<object>()

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue
    }

    visited.add(current)
    const details = current as Record<string, unknown>
    const status = details['statusCode'] ?? details['status']

    if (typeof status === 'number' && (status >= 500 || status === 429)) {
      return CompletionFailureKind.Unavailable
    }
    if (CONTEXT_ERROR_CODES.has(String(details['code'])) ||
      details['param'] === COMPACTION_PARAMETER) {
      return CompletionFailureKind.Context
    }

    pending.push(details['cause'], details['error'], details['data'], details['response'])
  }

  return CompletionFailureKind.Provider
}

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
  if (getConnectionErrorCode(error)) {
    return true
  }

  const pending: unknown[] = [error]
  const visited = new Set<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || typeof current !== 'object' || visited.has(current)) {
      continue
    }

    visited.add(current)
    const details = current as Record<string, unknown>
    const status = details['statusCode'] ?? details['status']
    if (typeof status === 'number' && status >= 400) {
      return status >= 500 || status === 408 || status === 429
    }
    if (details['isRetryable'] === true || details['closeCode'] === 1_006) {
      return true
    }

    pending.push(details['cause'], details['error'], details['response'])
  }

  if (axios.isAxiosError(error)) {
    return !error.response
  }

  const errorObject = error && typeof error === 'object'
    ? error as { message?: unknown, name?: unknown, status?: unknown }
    : null
  if (typeof errorObject?.status === 'number') {
    return false
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
export function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, delayMs)
    const abort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', abort, { once: true })
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
  const visited = new Set<object>()
  const readDetails = (value: unknown, depth = 0): unknown => {
    if (!value || typeof value !== 'object') {
      return typeof value === 'string' ? value : String(value)
    }
    if (visited.has(value) || depth >= MAX_ERROR_CAUSE_DEPTH) {
      return '[truncated]'
    }

    visited.add(value)
    const source = value as Record<string, unknown>
    const details: Record<string, unknown> = {}

    // SDK errors carry prompts and headers too. Retain only diagnostic fields,
    // explicitly reading Error.message because JSON omits it by default.
    for (const field of ERROR_DIAGNOSTIC_FIELDS) {
      if (typeof source[field] === 'string' || typeof source[field] === 'number' ||
        typeof source[field] === 'boolean') {
        details[field] = source[field]
      }
    }
    for (const field of ERROR_CAUSE_FIELDS) {
      if (source[field] !== undefined) {
        details[field] = readDetails(source[field], depth + 1)
      }
    }
    if (value instanceof AggregateError) {
      details['errors'] = value.errors.slice(0, MAX_ERROR_CAUSE_DEPTH)
        .map((cause) => readDetails(cause, depth + 1))
    }

    return details
  }

  return truncateForLog(StringHelper.redactSecrets(safeSerialize(readDetails(error))))
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

  const details = buildProviderErrorDetails(error)
  return truncateForLog(StringHelper.redactSecrets(
    message && message !== '[object Object]'
      ? `${name}: ${message} | ${details}`
      : details || String(error)
  ))
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
 * Prepares one recovery decision for execution and diagnostics. Waiting and
 * cancellation remain with the attempt so the remaining budget is checked again.
 */
export function prepareCompletionRetry(
  error: unknown,
  completionParams: PreparedCompletionParams,
  isRemoteProvider: boolean
): {
  retryDecision: ProviderRetryDecision
  retryReason: ProviderRetryReason
  params: CompletionParams | null
  delayMs: number
  message?: string
} {
  const stop = (retryReason: ProviderRetryReason): ReturnType<typeof prepareCompletionRetry> => ({
    retryDecision: ProviderRetryDecision.Stop, retryReason, params: null, delayMs: 0
  })
  const retry = (
    params: CompletionParams,
    message: string,
    delayMs = 0,
    retryReason = ProviderRetryReason.Transient
  ): ReturnType<typeof prepareCompletionRetry> => ({
    retryDecision: ProviderRetryDecision.Retry, retryReason, params, delayMs, message
  })
  if (isRequestSizeError(error)) {
    return stop(ProviderRetryReason.Size)
  }

  if ((completionParams.getRetryTimeout?.(completionParams.timeout) ?? completionParams.timeout) <= 0) {
    return stop(ProviderRetryReason.Deadline)
  }

  const remainingRetries = completionParams.maxRetries ?? 0
  const remainingProviderRetries = completionParams.remoteProviderErrorRetries ?? 0
  const thinkingConflict = isThinkingToolChoiceConflictError(error)
  const hasForcedToolChoice = Array.isArray(completionParams.tools) &&
    completionParams.tools.length > 0 && completionParams.toolChoice !== undefined &&
    completionParams.toolChoice !== 'auto'
  if (hasForcedToolChoice && !completionParams.relaxForcedToolChoice &&
    remainingRetries > 0 && (thinkingConflict || isUnsupportedToolChoiceError(error))) {
    const disableThinking = thinkingConflict && completionParams.disableThinking !== true

    const message = disableThinking
      ? 'Provider rejected forced tool_choice with thinking enabled; retrying with thinking disabled while keeping tool_choice'
      : 'Provider rejected forced tool_choice; retrying without tool_choice for compatibility'

    return retry(
      {
        ...(disableThinking ? completionParams : withOmittedToolChoice(completionParams)),
        ...(disableThinking ? { disableThinking: true } : { relaxForcedToolChoice: true }),
        maxRetries: remainingRetries - 1
      },
      message,
      0,
      ProviderRetryReason.Compatibility
    )
  }

  const details = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {}
  if (details['providerCompleted'] === true) {
    return stop(ProviderRetryReason.Completed)
  }
  const connectionCode = getConnectionErrorCode(error)
  const canRetryInterruptedResponse = Boolean(
    connectionCode && completionParams.retryInterruptedResponse
  )
  if (typeof details['firstOutputMs'] === 'number' && !canRetryInterruptedResponse) {
    return stop(ProviderRetryReason.Output)
  }
  if (connectionCode) {
    // Acceptance alone does not execute Leon's local tools. Callers that retain
    // provisional output or permit provider-owned work must still stop here.
    if (details['requestAcceptedMs'] !== undefined && !canRetryInterruptedResponse) {
      return stop(ProviderRetryReason.Accepted)
    }
    const remaining = completionParams.connectionErrorRetries ??
      (remainingProviderRetries <= 0 ? 0 : completionParams.dutyType === LLMDuties.ReAct
        ? MAX_PROVIDER_CONNECTION_RETRIES
        : remainingProviderRetries)
    if (remaining <= 0) {
      return stop(ProviderRetryReason.Exhausted)
    }
    const attempt = (completionParams.connectionRetryAttempt ?? 0) + 1
    const delayMs = REMOTE_PROVIDER_ERROR_RETRY_DELAY_MS * attempt
    const remainingTime = completionParams.getRetryTimeout?.(delayMs + completionParams.timeout)
    if (remainingTime !== undefined && remainingTime <= delayMs) {
      return stop(ProviderRetryReason.Deadline)
    }

    return retry(
      {
        ...completionParams,
        connectionErrorRetries: remaining - 1,
        connectionRetryAttempt: attempt,
        remoteProviderErrorRetries: 0
      },
      `Provider connection failed (${connectionCode}); retry ${attempt}/${attempt + remaining - 1} after ${delayMs}ms`,
      delayMs,
      ProviderRetryReason.Connection
    )
  }
  if (typeof details['elapsedMs'] === 'number' &&
    details['elapsedMs'] > MAX_TRANSIENT_FAILURE_RETRY_ELAPSED_MS) {
    return stop(ProviderRetryReason.Slow)
  }

  const isTimeout = isTimeoutLikeError(error)
  if (!isTimeout && !isRetryablePromptError(error)) {
    return stop(ProviderRetryReason.Permanent)
  }
  const usesExecutionRetry = !isRemoteProvider || isTimeout
  if (remainingProviderRetries <= 0 || (usesExecutionRetry && remainingRetries <= 0)) {
    return stop(ProviderRetryReason.Exhausted)
  }

  const delayMs = isTimeout ? 0 : isRemoteProvider
    ? REMOTE_PROVIDER_ERROR_RETRY_DELAY_MS
    : RETRYABLE_ERROR_RETRY_DELAY_MS
  const params = getPromptAbortReason(error)?.shouldRetry
    ? omitCompletionSignal(completionParams)
    : completionParams

  const message = isTimeout
    ? `Prompt timed out. Previous inference canceled; retrying within the remaining inference budget (${remainingProviderRetries} retry left)`
    : `Provider failed; retrying after ${delayMs}ms (${remainingProviderRetries} retry left)`

  return retry(
    {
      ...params,
      ...(usesExecutionRetry ? { maxRetries: remainingRetries - 1 } : {}),
      remoteProviderErrorRetries: remainingProviderRetries - 1
    },
    message,
    completionParams.getRetryTimeout?.(delayMs) ?? delayMs
  )
}
