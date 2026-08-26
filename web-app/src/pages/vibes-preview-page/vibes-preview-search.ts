import type { Theme } from '../../theme'
import {
  VIBE_CUP_STATES,
  VIBE_SEASONS,
  VIBE_SOLAR_PHASES,
  VIBE_WEATHER_CONDITIONS,
  type VibeCupState,
  type VibeEnvironment,
  type VibeInterior,
  type VibeSeason,
  type VibeSolarPhase,
  type VibeWeatherCondition
} from '../../components/vibes'
import { getVibeSurfaceForWeather } from '../../components/vibes'

const DEFAULT_LAMP_INTENSITY = .56
const THEMES: readonly Theme[] = ['dark', 'light']

export const VIBES_PREVIEW_PATH = '/vibes-preview'

export interface VibesPreviewSearch {
  cupState: VibeCupState
  lampIntensity: number
  lampOn: boolean
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

function getLampIntensity(value: unknown): number {
  const parsedValue = typeof value === 'number'
    ? value
    : Number.parseFloat(String(value))

  return Number.isFinite(parsedValue)
    ? Math.min(1, Math.max(0, parsedValue))
    : DEFAULT_LAMP_INTENSITY
}

/** Validates URL search values used by the development-only Vibes preview. */
export function parseVibesPreviewSearch(
  search: Record<string, unknown>
): VibesPreviewSearch {
  return {
    cupState: getValidValue(search['cupState'], VIBE_CUP_STATES, 'steaming'),
    lampIntensity: getLampIntensity(search['lampIntensity']),
    lampOn: search['lampOn'] === true || search['lampOn'] === 'true',
    season: getValidValue(search['season'], VIBE_SEASONS, 'autumn'),
    solarPhase: getValidValue(
      search['solarPhase'],
      VIBE_SOLAR_PHASES,
      'blue-hour'
    ),
    theme: getValidValue(search['theme'], THEMES, 'dark'),
    weather: getValidValue(search['weather'], VIBE_WEATHER_CONDITIONS, 'rain')
  }
}

/** Converts preview URL state into renderer inputs. */
export function getVibesPreviewConfiguration(search: VibesPreviewSearch): {
  environment: VibeEnvironment
  interior: Partial<VibeInterior> & {
    lamp: VibeInterior['lamp']
  }
} {
  return {
    environment: {
      season: search.season,
      solarPhase: search.solarPhase,
      surface: getVibeSurfaceForWeather(search.weather),
      weather: search.weather
    },
    interior: {
      cupState: search.cupState,
      lamp: {
        colorTemperatureKelvin: 2_400,
        intensity: search.lampIntensity,
        isOn: search.lampOn
      }
    }
  }
}
