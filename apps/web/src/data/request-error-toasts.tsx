import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useToast } from '@/components/toast'
import { PROFILE_AUTH_QUERY_KEY } from './profile'
import { requestErrors } from './request-errors'

/**
 * Connects cache-owned errors to the mounted toast UI without retaining a
 * component callback after unmount or exposing another profile's failures.
 */
export function RequestErrorToasts() {
  const client = useQueryClient()
  const { showToast } = useToast()

  useEffect(() => requestErrors.subscribe(({ profile, ...notification }) => {
    const activeProfile = client.getQueryData<{ profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)?.profile_name
    if (profile && profile !== activeProfile) {
      return
    }
    showToast(notification)
  }), [client, showToast])

  return null
}
