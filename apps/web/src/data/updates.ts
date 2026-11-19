import { useMutation, useQuery, useIsMutating, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'

import { requestAPI } from './api'
import { DESKTOP_UPDATES_PATH, DESKTOP_UPDATES_META_NAME } from '../../../../bridges/runtime/contracts/desktop-client'
import { queryClient } from '@/query-client'
import { UpdatePhase, type UpdateSnapshot } from '../../../../bridges/runtime/contracts/updates'

const UPDATE_STATUS_POLL_MS = 1_000
const UPDATE_IDLE_POLL_MS = 60_000
const updatesKey = ['updates'] as const

/**
 * Keeps host update status visible across reconnects without retrying writes or
 * presenting an expected restart outage as repeated connection-error toasts.
 */
export function useUpdates(profile: string): {
  query: UseQueryResult<UpdateSnapshot, Error>
  check: UseMutationResult<UpdateSnapshot, Error, void>
  apply: UseMutationResult<UpdateSnapshot, Error, string>
} {
  const key = [...updatesKey, profile]
  const applyKey = [...key, 'apply']
  const applying = useIsMutating({ mutationKey: applyKey }) > 0
  const query = useQuery({
    queryKey: key, enabled: Boolean(profile), retry: false,
    queryFn: async ({ signal }) => {
      try {
        return await requestAPI<UpdateSnapshot>('updates', { signal })
      } catch (error) {
        if (!document.querySelector(`meta[name="${DESKTOP_UPDATES_META_NAME}"]`) || signal.aborted) {
          throw error
        }
        // The native host can read the public receipt while Core is stopped.
        // Browser clients keep the last state and show a reconnect loader.
        const response = await fetch(`${DESKTOP_UPDATES_PATH}core`, { signal })
        if (!response.ok) {
          throw error
        }
        const state = await response.json() as UpdateSnapshot['state']
        if (!state) {
          throw error
        }
        return { check: queryClient.getQueryData<UpdateSnapshot>(key)?.check ?? null, state }
      }
    },
    meta: { profile, errorToast: false },
    refetchInterval: (query) => {
      const phase = query.state.data?.state?.phase

      return applying || phase && [UpdatePhase.Scheduled, UpdatePhase.Installing, UpdatePhase.Restarting].some((value) => value === phase)
        ? UPDATE_STATUS_POLL_MS : UPDATE_IDLE_POLL_MS
    }
  })
  const check = useMutation({
    mutationFn: () => requestAPI<UpdateSnapshot>('updates/check', { method: 'POST' }),
    meta: { profile, errorTitle: 'I couldn’t check for updates' },
    onSuccess: (snapshot) => queryClient.setQueryData(key, snapshot)
  })
  const apply = useMutation({
    mutationKey: applyKey,
    mutationFn: (tag: string) => requestAPI<UpdateSnapshot>('updates/apply', { method: 'POST', body: JSON.stringify({ tag }) }),
    meta: { profile, errorTitle: 'I couldn’t start the update' },
    onSuccess: (snapshot) => queryClient.setQueryData(key, snapshot)
  })

  return { query, check, apply }
}
