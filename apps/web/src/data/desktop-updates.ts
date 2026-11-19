import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'

import { DESKTOP_UPDATES_PATH, DESKTOP_UPDATES_META_NAME } from '../../../../bridges/runtime/contracts/desktop-client'
import type { DesktopUpdateSnapshot } from '../../../../bridges/runtime/contracts/updates'

const KEY = ['desktop-updates'] as const

async function request(action: string, version?: string): Promise<DesktopUpdateSnapshot> {
  const response = await fetch(`${DESKTOP_UPDATES_PATH}${action}`, action === 'state' ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version })
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(result.message ?? 'I could not update my desktop app.')
  }
  return result as DesktopUpdateSnapshot
}

/**
 * Subscribes once to the local host with no idle polling or GitHub requests.
 * Native updates are app-wide; Core's existing query remains profile-scoped.
 */
export function useDesktopUpdates(): {
  query: UseQueryResult<DesktopUpdateSnapshot, Error>
  check: UseMutationResult<DesktopUpdateSnapshot, Error, void>
  download: UseMutationResult<DesktopUpdateSnapshot, Error, void>
  install: UseMutationResult<DesktopUpdateSnapshot, Error, void>
} {
  const queryClient = useQueryClient()
  const enabled = Boolean(document.querySelector(`meta[name="${DESKTOP_UPDATES_META_NAME}"]`))
  const query = useQuery({ queryKey: KEY, enabled, queryFn: () => request('state'), retry: false,
    refetchOnWindowFocus: false, meta: { errorToast: false } })
  useEffect(() => {
    if (!enabled) {
      return
    }
    const events = new EventSource(`${DESKTOP_UPDATES_PATH}events`)
    events.onmessage = (event): void => {
      queryClient.setQueryData(KEY, JSON.parse(event.data) as DesktopUpdateSnapshot)
    }
    return (): void => events.close()
  }, [enabled, queryClient])
  const check = useMutation({ mutationFn: () => request('check'),
    meta: { errorTitle: 'I couldn’t check desktop updates' }, onSuccess: (state) => queryClient.setQueryData(KEY, state) })
  const download = useMutation({ mutationFn: () => request('download', query.data?.version ?? undefined),
    meta: { errorTitle: 'I couldn’t download my desktop update' },
    onSuccess: (state) => queryClient.setQueryData(KEY, state) })
  const install = useMutation({ mutationFn: () => request('install', query.data?.version ?? undefined),
    meta: { errorTitle: 'I couldn’t restart my desktop app' },
    onSuccess: (state) => queryClient.setQueryData(KEY, state) })
  return { query, check, download, install }
}
