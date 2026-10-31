import {
  useQuery,
  type UseQueryResult
} from '@tanstack/react-query'

import { LEON_SERVER_URL } from '@/config'
import { useProfile } from './profile'

const AMBIENT_CONDITIONS_API_PATH = '/api/v1/ambient'
const AMBIENT_CONDITIONS_REFRESH_INTERVAL_MS = 10 * 60 * 1_000
export const AMBIENT_CONDITIONS_QUERY_KEY = ['ambient-conditions'] as const

type AmbientSeason = 'spring' | 'summer' | 'autumn' | 'winter'
type AmbientSolarPhase =
  | 'sunrise'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'sunset'
  | 'blue-hour'
  | 'night'
type AmbientWeatherCondition =
  | 'clear'
  | 'partly-cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'storm'
  | 'snow'

export interface AmbientConditions {
  mood?: 'default' | 'sad' | 'cocky' | 'tired' | 'angry'
  season: AmbientSeason
  solarPhase: AmbientSolarPhase
  timeZone: string
  weather: {
    condition: AmbientWeatherCondition
    description: string
    feelsLikeC: number
    fetchedAt: number
    location: string
    observationTime: string
    temperatureC: number
    weatherCode: number
    solar?: {
      date: string
      timeZone: string
      sunrise: number
      sunset: number
    } | null
  } | null
}

interface AmbientConditionsResponse {
  ambient: AmbientConditions
  success: boolean
}

async function fetchAmbientConditions(signal: AbortSignal): Promise<AmbientConditions> {
  const response = await fetch(`${LEON_SERVER_URL}${AMBIENT_CONDITIONS_API_PATH}`, {
    credentials: 'include', signal
  })

  if (!response.ok) {
    throw new Error(`Unable to fetch ambient conditions (${response.status}).`)
  }

  const payload = await response.json() as AmbientConditionsResponse

  if (!payload.success) {
    throw new Error('Unable to fetch ambient conditions.')
  }

  return payload.ambient
}

/**
 * Keep the active page aligned with local time while the server caches weather.
 */
export function useAmbientConditions(
  enabled = true
): UseQueryResult<AmbientConditions, Error> {
  const profile = useProfile()

  return useQuery({
    queryKey: [...AMBIENT_CONDITIONS_QUERY_KEY, profile],
    meta: { errorTitle: 'Could not load ambient conditions' },
    queryFn: ({ signal }) => fetchAmbientConditions(signal),
    enabled: enabled && Boolean(profile),
    refetchInterval: AMBIENT_CONDITIONS_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: AMBIENT_CONDITIONS_REFRESH_INTERVAL_MS
  })
}
