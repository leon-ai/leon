import type { Theme } from '@/theme'
import {
  VIBE_SEASONS,
  VIBE_SOLAR_PHASES,
  VIBE_WEATHER_CONDITIONS,
  type VibeEnvironment,
  type VibeSeason,
  type VibeSolarPhase,
  type VibeWeatherCondition
} from '@/components/vibes'
import { getVibeSurfaceForWeather } from '@/components/vibes'

const THEMES: readonly Theme[] = ['dark', 'light']

export const VIBES_PREVIEW_PATH = '/vibes-preview'

export interface VibesPreviewSearch {
  season: VibeSeason
  solarPhase: VibeSolarPhase
  theme: Theme
  weather: VibeWeatherCondition
}

function getValidValue<T extends string>(
  value: unknown,
  values: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' && values.includes(value as T)
    ? value as T
    : fallback
}

/**
 * Validates URL search values used by the development-only Vibes preview.
 */
export function parseVibesPreviewSearch(
  search: Record<string, unknown>
): VibesPreviewSearch {
  return {
    season: getValidValue(search['season'], VIBE_SEASONS, 'autumn'),
    solarPhase: getValidValue(
      search['solarPhase'],
      VIBE_SOLAR_PHASES,
      'blue-hour'
    ),
    theme: getValidValue(search['theme'], THEMES, 'light'),
    weather: getValidValue(search['weather'], VIBE_WEATHER_CONDITIONS, 'rain')
  }
}

/**
 * Converts preview URL state into renderer inputs.
 */
export function getVibesPreviewConfiguration(
  search: VibesPreviewSearch
): { environment: VibeEnvironment } {
  return {
    environment: {
      season: search.season,
      solarPhase: search.solarPhase,
      surface: getVibeSurfaceForWeather(search.weather),
      weather: search.weather
    }
  }
}
