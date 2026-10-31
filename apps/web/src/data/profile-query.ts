import { queryOptions, type QueryClient } from '@tanstack/react-query'

import { PROFILE_AUTH_BOOTSTRAP_ID, type ProfileAuthentication } from '../../../../server/src/core/http-server/profile-auth-contract'
import { requestAPI } from './api'

export const PROFILE_AUTH_QUERY_KEY = ['profile-auth'] as const

/**
 * Shares identity validation between early startup and mounted observers.
 */
export const profileAuthQueryOptions = queryOptions({
  queryKey: PROFILE_AUTH_QUERY_KEY,
  meta: { errorTitle: 'Could not connect to Leon', suppressBackgroundError: true },
  queryFn: ({ signal }) => requestAPI<ProfileAuthentication>('profile-auth', { signal }),
  refetchOnWindowFocus: false
})

/**
 * Uses request-specific server metadata when available; standalone serving starts
 * one shared auth probe before React without persisting identity or credentials.
 */
export function initializeProfileAuthentication(client: QueryClient): void {
  const bootstrap = document.getElementById(PROFILE_AUTH_BOOTSTRAP_ID)
  if (bootstrap) {
    try {
      const value = JSON.parse(bootstrap.textContent ?? '') as Partial<ProfileAuthentication> | null
      if (value?.authenticated === true && typeof value.profile_name === 'string' && value.profile_name.trim() ||
        value?.authenticated === false && value.profile_name === null) {
        client.setQueryData(PROFILE_AUTH_QUERY_KEY, {
          authenticated: value.authenticated, profile_name: value.profile_name
        })
      }
    } catch {
      // Invalid or absent bootstrap metadata falls back to the normal auth probe.
    } finally {
      bootstrap.remove()
    }
  }
  void client.prefetchQuery(profileAuthQueryOptions)
}
