import type {
  VibeSeason,
  VibeSolarPhase,
  VibeWeatherCondition
} from './vibes-scenes'

import { getPublicAssetPath } from '@/config'
import type { Theme } from '@/theme'

const NATIONAL_LOCATION_PATH_SEGMENT = 'national'
const VIBE_SCENE_THEME_FILE_SUFFIXES: Record<Theme, string> = {
  dark: '',
  light: '.light'
}

export interface VibeLocation {
  /**
   * Lowercase ISO 3166-1 alpha-2 country code.
   */
  countryCode: string
  /**
   * Stable lowercase locality slug supplied by the location provider.
   */
  locality?: string
}

export type VibeLocationInput = Partial<VibeLocation>

export interface VibeLandscape {
  /**
   * Stable subject identifier, allowing several views for one location.
   */
  id: string
  location: VibeLocation
}

export const DEFAULT_VIBE_LANDSCAPE = {
  id: 'main-view',
  location: {
    countryCode: 'fr',
    locality: 'my-hometown'
  }
} as const satisfies VibeLandscape

/**
 * Builds the canonical path used by future location-aware landscapes.
 */
export function getVibeLandscapeAssetPath(
  landscape: VibeLandscape,
  season: VibeSeason,
  weather: VibeWeatherCondition,
  solarPhase: VibeSolarPhase
): string {
  const locationPath = landscape.location.locality ??
    NATIONAL_LOCATION_PATH_SEGMENT

  return getPublicAssetPath([
    'img/vibes/landscapes',
    landscape.location.countryCode,
    locationPath,
    landscape.id,
    season,
    weather,
    `${solarPhase}.webp`
  ].join('/'))
}

/**
 * Builds the canonical path for a complete location-aware Vibes scene.
 */
export function getVibeSceneAssetPath(
  landscape: VibeLandscape,
  season: VibeSeason,
  weather: VibeWeatherCondition,
  solarPhase: VibeSolarPhase,
  theme: Theme
): string {
  const locationPath = landscape.location.locality ??
    NATIONAL_LOCATION_PATH_SEGMENT
  const themeFileSuffix = VIBE_SCENE_THEME_FILE_SUFFIXES[theme]

  return getPublicAssetPath([
    'img/vibes/scenes',
    landscape.location.countryCode,
    locationPath,
    landscape.id,
    season,
    weather,
    `${solarPhase}${themeFileSuffix}.webp`
  ].join('/'))
}
