import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'

import { useToast } from '@/components/toast'
import type {
  TelemetrySetting
} from '../../../../server/src/core/insights/insights-contract'

import { requestAPI } from './api'
import { PROFILE_AUTH_QUERY_KEY, useProfile } from './profile'

const INSIGHTS_ENDPOINT = 'insights'
const PROFILE_HEADER = 'x-leon-insights-profile'

/**
 * Applies only consent changes acknowledged by Core for the current profile.
 */
export function useTelemetrySetting(): {
  setting: UseQueryResult<TelemetrySetting>
  change: UseMutationResult<TelemetrySetting, Error, boolean>
} {
  const profile = useProfile()
  const client = useQueryClient()
  const { showToast } = useToast()
  const queryKey = ['telemetry-settings', profile] as const
  const setting = useQuery({
    queryKey,
    queryFn: ({ signal }) => requestAPI<TelemetrySetting>(`${INSIGHTS_ENDPOINT}/telemetry`, { signal, headers: { [PROFILE_HEADER]: profile } }),
    enabled: Boolean(profile)
  })
  const change = useMutation({
    mutationFn: (enabled: boolean) => requestAPI<TelemetrySetting>(`${INSIGHTS_ENDPOINT}/telemetry`, {
      method: 'PUT',
      headers: { [PROFILE_HEADER]: profile },
      body: JSON.stringify({ enabled })
    }),
    onSuccess: (result) => {
      client.setQueryData(queryKey, result)
      if (client.getQueryData<{ profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)?.profile_name !== profile) {
        return
      }
      showToast({
        title: result.enabled ? 'Usage sharing enabled' : 'Usage sharing disabled',
        type: 'success', description: ''
      })
    },
    retry: false, meta: { profile, errorTitle: 'Could not change usage sharing' }
  })
  return { setting, change }
}
