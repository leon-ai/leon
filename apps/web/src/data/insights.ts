import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'

import { useToast } from '@/components/toast'
import type {
  InsightsInterval, InsightsUsage, EvaluationHistoryView, EvaluationQuery, TelemetrySetting
} from '../../../../server/src/core/insights/insights-contract'

import { requestAPI } from './api'
import { PROFILE_AUTH_QUERY_KEY, useProfile } from './profile'

const INSIGHTS_STALE_MS = 60_000
const EVALUATION_STALE_MS = 5 * 60_000
const INSIGHTS_ENDPOINT = 'insights'
const PROFILE_HEADER = 'x-leon-insights-profile'

/**
 * Reads only the active owner's activity and cancels obsolete filter requests.
 */
export function useInsightsUsage(
  { days, provider, model, repeated, interval, contextPage, enabled }: {
    days: number
    provider: string
    model: string
    repeated: boolean
    interval: InsightsInterval
    contextPage: number | undefined
    enabled: boolean
  }
): UseQueryResult<InsightsUsage> {
  const profile = useProfile()
  const query = new URLSearchParams({ days: String(days), interval })
  if (provider) {
    query.set('provider', provider)
  }
  if (model) {
    query.set('model', model)
  }
  if (repeated) {
    query.set('repeated', 'true')
  }
  if (contextPage !== undefined) {
    query.set('contextPage', String(contextPage))
  }

  return useQuery({
    queryKey: ['insights-usage', profile, days, provider, model, repeated, interval, contextPage],
    queryFn: ({ signal }) => requestAPI<InsightsUsage>(`${INSIGHTS_ENDPOINT}?${query}`, { signal, headers: { [PROFILE_HEADER]: profile } }),
    staleTime: INSIGHTS_STALE_MS,
    placeholderData: keepPreviousData,
    enabled: Boolean(profile) && enabled
  })
}

/**
 * Requests only the selected evaluation series and page for the active profile.
 */
export function useInsightsEvaluations(filters: EvaluationQuery): UseQueryResult<EvaluationHistoryView> {
  const profile = useProfile()
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) {
      query.set(key, String(value))
    }
  }

  return useQuery({
    queryKey: ['insights-evaluations', profile, filters],
    queryFn: ({ signal }) => requestAPI<EvaluationHistoryView>(`${INSIGHTS_ENDPOINT}/evaluations?${query}`, {
      signal, headers: { [PROFILE_HEADER]: profile }
    }),
    enabled: Boolean(profile),
    staleTime: EVALUATION_STALE_MS,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1
  })
}

/**
 * Applies only consent changes acknowledged by the server for the current profile.
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
