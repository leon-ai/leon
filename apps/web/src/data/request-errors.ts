import { MutationCache, QueryCache, isCancelledError } from '@tanstack/react-query'

const ERROR_NOTIFICATION_COOLDOWN_MS = 3_000
const MAXIMUM_RECENT_ERRORS = 32
const DEFAULT_ERROR_TITLE = 'The request could not be completed'
const DEFAULT_ERROR_DESCRIPTION = 'Please try again.'

enum RequestErrorOrigin {
  Request,
  Mutation
}

export interface RequestErrorMeta extends Record<string, unknown> {
  errorTitle?: string
  errorToast?: boolean
  errorType?: 'error' | 'warning'
  profile?: string
  suppressBackgroundError?: boolean
}

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: RequestErrorMeta
    mutationMeta: RequestErrorMeta
  }
}

export class APIError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message)
  }
}

export class ConnectionError extends Error {
  public constructor(message = 'Unable to reach Leon. Check your connection and try again.') {
    super(message)
  }
}

interface RequestErrorNotification {
  type: 'error' | 'warning'
  title: string
  description: string
  profile?: string
}

interface RequestErrorReporter {
  queryCache: QueryCache
  mutationCache: MutationCache
  report: (error: unknown, meta?: RequestErrorMeta) => void
  subscribe: (listener: (notification: RequestErrorNotification) => void) => () => void
}

function isRequestCancellation(error: unknown): boolean {
  return isCancelledError(error) || error instanceof Error && error.name === 'AbortError'
}

/**
 * Reports settled request failures once, independently of component observers.
 * Notification state is bounded and never owns retry or transport behavior.
 */
export function createRequestErrorReporter(): RequestErrorReporter {
  const listeners = new Set<(notification: RequestErrorNotification) => void>()
  const reportedErrors = new WeakSet<object>()
  const failedBackgroundQueries = new WeakSet<object>()
  const recentErrors = new Map<string, number>()

  const report = (
    error: unknown,
    meta: RequestErrorMeta = {},
    origin = RequestErrorOrigin.Request
  ): void => {
    if (meta.errorToast === false || listeners.size === 0 || isRequestCancellation(error)) {
      return
    }
    if (typeof error === 'object' && error !== null && reportedErrors.has(error)) {
      return
    }
    // Remember propagated failures even when a recent notification covers them.
    if (typeof error === 'object' && error !== null) {
      reportedErrors.add(error)
    }

    const description = error instanceof Error && error.message.trim()
      ? error.message : DEFAULT_ERROR_DESCRIPTION
    const title = meta.errorTitle ?? DEFAULT_ERROR_TITLE
    // A connection warning must not hide whether an explicit action was saved.
    const signature = JSON.stringify([meta.profile,
      error instanceof ConnectionError && origin !== RequestErrorOrigin.Mutation
        ? 'connection' : [title, description]])
    const now = Date.now()
    for (const [key, notifiedAt] of recentErrors) {
      if (now - notifiedAt >= ERROR_NOTIFICATION_COOLDOWN_MS) {
        recentErrors.delete(key)
      }
    }
    if (recentErrors.has(signature)) {
      return
    }

    recentErrors.set(signature, now)
    if (recentErrors.size > MAXIMUM_RECENT_ERRORS) {
      recentErrors.delete(recentErrors.keys().next().value!)
    }
    for (const listener of listeners) {
      listener({
        type: meta.errorType ?? 'error', title, description,
        ...(meta.profile ? { profile: meta.profile } : {})
      })
    }
  }

  return {
    report,
    subscribe: (listener): (() => void) => {
      listeners.add(listener)

      return (): void => {
        listeners.delete(listener)
      }
    },
    queryCache: new QueryCache({
      onError: (error, query): void => {
        if (isRequestCancellation(error)) {
          return
        }
        if (query.state.data !== undefined) {
          if (query.meta?.suppressBackgroundError || failedBackgroundQueries.has(query)) {
            return
          }
          failedBackgroundQueries.add(query)
        }
        report(error, query.meta)
      },
      onSuccess: (_data, query): void => {
        failedBackgroundQueries.delete(query)
      }
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation): void => {
        report(error, mutation.meta, RequestErrorOrigin.Mutation)
      }
    })
  }
}

export const requestErrors = createRequestErrorReporter()
