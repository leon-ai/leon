import { CompletionFailureKind } from '../../llm-manager/types'
import type { PublicModelLabel } from '@/core/telemetry/report-contract'
import { LogHelper } from '@/helpers/log-helper'
import type { InferenceFailureCode, OwnerTurnFailureCode } from './timing-contract'

const MODEL_FAILURE_CODES: Record<CompletionFailureKind, InferenceFailureCode> = {
  [CompletionFailureKind.Timeout]: 'timeout',
  [CompletionFailureKind.Connection]: 'connection',
  [CompletionFailureKind.Context]: 'context_limit',
  [CompletionFailureKind.Unavailable]: 'provider_unavailable',
  [CompletionFailureKind.Provider]: 'provider_error'
}

/**
 * Carries a known runtime failure and its target across the provider boundary.
 */
export class InferenceDiagnosticError extends Error {
  public constructor(
    message: string,
    public readonly diagnosticCode: InferenceFailureCode,
    options?: ErrorOptions & { inference?: PublicModelLabel }
  ) {
    super(message, options)
    this.inference = options?.inference
  }

  public readonly inference: PublicModelLabel | undefined
}

/**
 * Maps provider attempts and startup errors to fixed codes without reading error text.
 */
export function classifyInferenceFailure(
  error: unknown,
  kind?: CompletionFailureKind,
  connectionCode?: string
): InferenceFailureCode | undefined {
  if (error instanceof InferenceDiagnosticError) {
    return error.diagnosticCode
  }
  if (connectionCode === 'ECONNREFUSED' || (error as { code?: unknown } | null)?.code === 'ECONNREFUSED') {
    return 'connection_refused'
  }
  const code = classifyTurnFailure(error)

  if (code !== 'unknown' && code !== 'no_output') {
    return code
  }

  return connectionCode ? 'connection' : kind === undefined ? undefined : MODEL_FAILURE_CODES[kind]
}

/**
 * Keeps the diagnostic searchable even when a local log file cannot be written.
 */
export function logFailureDiagnostic(message: string): void {
  try {
    LogHelper.error(message)
  } catch {
    LogHelper.warning(message)
  }
}

/**
 * Classifies thrown errors using fixed codes and HTTP statuses only. Error bodies and messages stay local.
 */
export function classifyTurnFailure(error: unknown): OwnerTurnFailureCode {
  const detail = error as {
    name?: string
    code?: string
    status?: number
    statusCode?: number
    response?: { status?: number }
  } | null
  const status = detail?.status ?? detail?.statusCode ?? detail?.response?.status

  if (status === 429) {
    return 'rate_limit'
  }
  if (status === 401 || status === 403) {
    return 'authorization'
  }
  if (status === 408 || status === 504 || detail?.name === 'TimeoutError' || detail?.code === 'ETIMEDOUT') {
    return 'timeout'
  }
  if (detail?.code === 'ECONNREFUSED' || detail?.code === 'ECONNRESET' || detail?.code === 'ENOTFOUND') {
    return 'connection'
  }

  return 'unknown'
}
