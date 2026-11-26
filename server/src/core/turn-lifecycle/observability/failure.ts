import type { OwnerTurnFailureCode } from './timing-contract'

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
