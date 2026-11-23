import { useEffect, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DESKTOP_BOOTSTRAP_META_NAME, DESKTOP_BOOTSTRAP_PATH } from '../../../../../bridges/runtime/contracts/desktop-client'
import { DesktopSetupView, SetupPhase, type SetupState } from './desktop-setup'
import { DesktopStartupView } from './desktop-startup'

const STATE_KEY = ['desktop-setup'] as const
const bootstrap = document.querySelector<HTMLMetaElement>(`meta[name="${DESKTOP_BOOTSTRAP_META_NAME}"]`)

/**
 * Keeps profile requests behind real Core readiness, on the shared root URL.
 * One reload switches the bootstrap document to the selected Core's web assets.
 */
export function DesktopCoreBoundary({ children }: { children: ReactNode }) {
  if (!bootstrap) {
    return children
  }
  return <ManagedCore>{children}</ManagedCore>
}

async function request<T>(action: string, body?: object): Promise<T> {
  const response = await fetch(`${DESKTOP_BOOTSTRAP_PATH}${action}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  if (!response.ok) {
    const value = await response.json() as { message?: string }
    throw new Error(value.message ?? 'I could not prepare my Core.')
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}

function ManagedCore({ children }: { children: ReactNode }) {
  const cache = useQueryClient()
  const query = useQuery({ queryKey: STATE_KEY, queryFn: () => request<SetupState>('state'),
    retry: false, refetchOnWindowFocus: false, staleTime: Infinity })
  const action = useMutation({ mutationFn: (name: string) => request(name, {}) })
  const data = query.data
  const ready = data?.phase === SetupPhase.Complete

  useEffect(() => {
    const events = new EventSource(`${DESKTOP_BOOTSTRAP_PATH}events`)
    events.onmessage = (event) => cache.setQueryData(STATE_KEY, JSON.parse(event.data) as SetupState)
    return () => events.close()
  }, [cache])
  useEffect(() => {
    if (ready && bootstrap?.content === 'pending') {
      window.location.reload()
    }
  }, [ready])

  if (ready && bootstrap?.content === 'complete') {
    return children
  }
  if (!data || ready) {
    return query.error ? <main className="setup"><p role="alert">{query.error.message}</p></main> : <DesktopStartupView />
  }
  return <DesktopSetupView data={data} pending={action.isPending} error={action.error?.message ?? null}
    onStart={() => action.mutate('start')} onCancel={() => action.mutate('cancel')}
    onLogs={() => action.mutate('logs')} />
}
