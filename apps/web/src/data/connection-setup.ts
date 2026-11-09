import { useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ConnectionSetupActionId,
  ConnectionSetupStep,
  CONNECTION_SETUP_MESSAGES,
  type ConnectionSetupAction,
  type ConnectionSetupResult,
  type ConnectionSetupView
} from '../../../../aurora/src/contracts/connection-setup'
import { requestAPI } from './api'
import { openConnectionAuthorization, ConnectionAuthorizationError, type ConnectionAuthorizationPopup } from './connection-authorization'
import { useSendMessage } from './conversation-queries'
import { useProfile, PROFILE_AUTH_QUERY_KEY } from './profile'
import { queryClient } from '@/query-client'
import { router } from '@/router'
import { useToast } from '@/components/toast'

interface ConnectionSetupController {
  view: ConnectionSetupView | undefined
  loading: boolean
  busy: boolean
  error: string | undefined
  refresh: () => void
  act: (action: ConnectionSetupAction, state: ConnectionSetupView['state'], values: Record<string, string>) => Promise<void>
}

interface ConnectionSetupSnapshot {
  view: ConnectionSetupView
  authorizationFailed: boolean
}

const SETUP_CACHE_TIME_MS = 60_000

/**
 * Uses Query for safe server screens and mutation lifecycle, but never puts
 * credentials in mutation variables, cached results, drafts or owner messages.
 */
export function useConnectionSetup(sessionId: string, provider: string): ConnectionSetupController {
  const profile = useProfile()
  const send = useSendMessage(sessionId)
  const { showToast } = useToast()
  const credentials = useRef<Record<string, string> | undefined>(undefined)
  const controller = useRef<AbortController | undefined>(undefined)
  const continuation = useRef<{ id: string, query: string } | undefined>(undefined)
  const popup = useRef<ConnectionAuthorizationPopup | undefined>(undefined)
  const popupError = useRef<unknown>(undefined)
  const scope = `${profile}:${sessionId}:${provider}`
  const authorization = useRef({ scope, failed: false })
  const currentScope = useRef(scope)
  currentScope.current = scope
  const key = ['connection-setup', profile, sessionId, provider]

  useEffect(() => {
    currentScope.current = scope

    const dispose = (): void => {
      currentScope.current = ''
      credentials.current = undefined
      controller.current?.abort()
      popup.current?.dispose()
      popup.current = undefined
    }
    const restore = (): void => {
      currentScope.current = scope
    }
    window.addEventListener('pagehide', dispose)
    window.addEventListener('pageshow', restore)

    return (): void => {
      window.removeEventListener('pagehide', dispose)
      window.removeEventListener('pageshow', restore)
      dispose()
    }
  }, [scope])

  function isCurrent(): boolean {
    return currentScope.current === scope &&
      queryClient.getQueryData<{ profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)?.profile_name === profile
  }

  async function request(action: ConnectionSetupAction, state: ConnectionSetupView['state'] | undefined,
    values: Record<string, string>, signal: AbortSignal, popupReturnURL?: string): Promise<ConnectionSetupResult> {
    const returnURL = new URL(window.location.href)
    returnURL.searchParams.set('connection_session', sessionId)
    if (state) {
      returnURL.searchParams.set('connection_method', state.method)
    }
    const returned = returnURL.searchParams.get('provider') === provider && returnURL.searchParams.has('connection_result')
    if (authorization.current.scope !== scope) {
      authorization.current = { scope, failed: queryClient.getQueryData<ConnectionSetupSnapshot>(key)?.authorizationFailed ?? false }
    }
    if (!returned && action.id === ConnectionSetupActionId.Refresh) {
      authorization.current.failed ||= queryClient.getQueryData<ConnectionSetupSnapshot>(key)?.authorizationFailed ?? false
    }
    if (returned) {
      authorization.current.failed = returnURL.searchParams.get('connection_result') !== 'connected'
    } else if (action.id !== ConnectionSetupActionId.Refresh) {
      authorization.current.failed = false
    }
    const method = returnURL.searchParams.get('connection_method')
    const requestState = state ?? (returned && method ? { method, step: ConnectionSetupStep.Credentials } : undefined)
    const result = await requestAPI<ConnectionSetupResult>(`connections/${encodeURIComponent(provider)}/setup`, {
      method: 'POST', signal, cache: 'no-store', body: JSON.stringify({
        action: action.id, method: action.method, state: requestState, credentials: values,
        session_id: sessionId, return_url: popupReturnURL ?? returnURL.toString(),
        authorization_failed: authorization.current.failed
      })
    })

    return result
  }

  const query = useQuery({
    queryKey: key,
    enabled: Boolean(profile && sessionId && provider),
    meta: { errorTitle: CONNECTION_SETUP_MESSAGES.loadError, profile },
    queryFn: async ({ signal }) => {
      const state = queryClient.getQueryData<ConnectionSetupSnapshot>(key)?.view.state
      const result = await request({ id: ConnectionSetupActionId.Refresh, label: 'Refresh' }, state, {}, signal)

      return { view: result.view, authorizationFailed: authorization.current.failed }
    },
    retry: false,
    staleTime: 0,
    gcTime: SETUP_CACHE_TIME_MS,
    refetchOnWindowFocus: () => controller.current ? false : 'always'
  })

  useEffect(() => {
    if (!query.data || !isCurrent()) {
      return
    }
    const url = new URL(window.location.href)
    if (url.searchParams.get('provider') !== provider || !url.searchParams.has('connection_result')) {
      return
    }

    // Commit the safe outcome before cleaning the URL, so route remounts cannot
    // lose a cancellation notice or repeat callback handling.
    url.searchParams.delete('provider')
    url.searchParams.delete('connection_result')
    url.searchParams.delete('connection_session')
    url.searchParams.delete('connection_method')
    router.history.replace(`${url.pathname}${url.search}${url.hash}`, router.history.location.state)
  }, [query.data, scope, provider])

  const mutation = useMutation({
    meta: { errorTitle: CONNECTION_SETUP_MESSAGES.actionError, profile },
    retry: false,
    gcTime: 0,
    mutationFn: async ({ action, state }: { action: ConnectionSetupAction, state: ConnectionSetupView['state'] }) => {
      const values = credentials.current ?? {}
      credentials.current = undefined
      if (!isCurrent()) {
        throw new DOMException('Connection setup is no longer active.', 'AbortError')
      }
      const abort = new AbortController()
      controller.current = abort
      const authorizationPopup = popup.current
      try {
        if (popupError.current) {
          const error = popupError.current
          popupError.current = undefined
          throw error
        }
        let result: ConnectionSetupResult
        try {
          result = await request(action, state, values, abort.signal, authorizationPopup?.returnURL)
        } finally {
          // OAuth can outlive the HTTP submission; never retain submitted secrets
          // while waiting for the owner to authorize on the provider's website.
          for (const name of Object.keys(values)) {
            values[name] = ''
          }
        }
        if (!isCurrent()) {
          throw new DOMException('Connection setup is no longer active.', 'AbortError')
        }
        if (result.event) {
          if (result.event.methodName !== 'send_utterance' || result.event.session_id !== sessionId || result.event.methodParams.from !== 'owner') {
            throw new Error(CONNECTION_SETUP_MESSAGES.actionError)
          }
          const query = result.event.methodParams.utterance
          if (continuation.current?.query !== query) {
            continuation.current = { id: crypto.randomUUID(), query }
          }
          // Reuse the normal owner-command path and its stable retry identity.
          await send.mutateAsync(continuation.current)
          continuation.current = undefined
        }
        if (!isCurrent()) {
          throw new DOMException('Connection setup is no longer active.', 'AbortError')
        }
        if (result.authorization_url) {
          if (!authorizationPopup) {
            throw new Error(CONNECTION_SETUP_MESSAGES.actionError)
          }
          const outcome = await authorizationPopup.authorize(result.authorization_url, abort.signal)
          if (!isCurrent()) {
            throw new DOMException('Connection setup is no longer active.', 'AbortError')
          }
          authorization.current.failed = outcome !== 'connected'
          result = await request({ id: ConnectionSetupActionId.Refresh, label: 'Refresh' }, state, {}, abort.signal)
          if (outcome === 'connected' && result.view.state.step !== ConnectionSetupStep.Connected) {
            throw new Error(CONNECTION_SETUP_MESSAGES.actionError)
          }
        }
        if (!isCurrent()) {
          throw new DOMException('Connection setup is no longer active.', 'AbortError')
        }
        queryClient.setQueryData<ConnectionSetupSnapshot>(key, {
          view: result.view, authorizationFailed: authorization.current.failed
        })
        if (action.id === ConnectionSetupActionId.Connect && result.view.state.step === ConnectionSetupStep.Connected) {
          showToast({ type: 'success', title: 'Account connected', description: 'You can continue your request.' })
        }

        return result.view
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error
        }
        if (error instanceof ConnectionAuthorizationError) {
          throw error
        }
        // Never retain a transport/provider error that might include its request.
        throw new Error(CONNECTION_SETUP_MESSAGES.actionError)
      } finally {
        authorizationPopup?.dispose()
        if (popup.current === authorizationPopup) {
          popup.current = undefined
        }
        for (const name of Object.keys(values)) {
          values[name] = ''
        }
        if (controller.current === abort) {
          controller.current = undefined
        }
      }
    }
  })

  return {
    view: query.data?.view,
    loading: query.isFetching,
    busy: mutation.isPending,
    error: mutation.isError ? mutation.error instanceof ConnectionAuthorizationError
      ? mutation.error.message : CONNECTION_SETUP_MESSAGES.actionError : query.isError ? CONNECTION_SETUP_MESSAGES.loadError : undefined,
    refresh: (): void => {
      mutation.reset()
      void query.refetch()
    },
    act: async (action: ConnectionSetupAction, state: ConnectionSetupView['state'], values: Record<string, string>): Promise<void> => {
      credentials.current = values
      try {
        // Reserve before any await, while browser user activation still exists.
        if (action.id === ConnectionSetupActionId.Connect && state.method === 'oauth') {
          try {
            popup.current = openConnectionAuthorization(provider)
          } catch (error) {
            popupError.current = error
          }
        }
        await queryClient.cancelQueries({ queryKey: key, exact: true })
        await mutation.mutateAsync({ action, state })
      } finally {
        credentials.current = undefined
        popup.current?.dispose()
        popup.current = undefined
        popupError.current = undefined
      }
    }
  }
}
