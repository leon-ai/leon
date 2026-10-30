import {
  DEFAULT_VIBE_LANDSCAPE,
  getVibeSceneAssetPath,
  type VibeLandscape
} from './vibes-landscapes'

import type { Theme } from '@/theme'

export const VIBE_SEASONS = [
  'spring',
  'summer',
  'autumn',
  'winter'
] as const

export const VIBE_SOLAR_PHASES = [
  'sunrise',
  'morning',
  'noon',
  'afternoon',
  'sunset',
  'blue-hour',
  'night'
] as const

export const VIBE_WEATHER_CONDITIONS = [
  'clear',
  'partly-cloudy',
  'overcast',
  'fog',
  'drizzle',
  'rain',
  'storm',
  'snow'
] as const

export type VibeSeason = typeof VIBE_SEASONS[number]
export type VibeSolarPhase = typeof VIBE_SOLAR_PHASES[number]
export type VibeWeatherCondition = typeof VIBE_WEATHER_CONDITIONS[number]

export type VibeSurfaceCondition = 'dry' | 'wet' | 'snow-covered'
export type VibeSceneId =
  `${VibeSeason}-${VibeWeatherCondition}-${VibeSolarPhase}`

export interface VibeEnvironment {
  season: VibeSeason
  solarPhase: VibeSolarPhase
  surface: VibeSurfaceCondition
  weather: VibeWeatherCondition
}

export interface VibeWindowGeometry {
  height: string
  landscapeClipPath: string
  right: string
  top: string
  weatherClipPath: string
  width: string
}

interface VibeScenePresentation {
  brightness: number
  contrast: number
  maskOpacity: number
  opacity: number
  saturation: number
}

interface VibeSceneAssets {
  sceneSrcByTheme: Record<Theme, string>
  type: 'composite'
}

export interface VibeScene {
  assets: VibeSceneAssets
  environment: VibeEnvironment
  landscape: VibeLandscape
  presentation: {
    dark: VibeScenePresentation
    light: VibeScenePresentation
  }
  window: VibeWindowGeometry
}

const SUMMER_CLEAR_NOON_WINDOW = {
  height: '55%',
  landscapeClipPath: 'polygon(3% 2%, 98% 0, 96% 96%, 1% 93%)',
  right: '4%',
  top: '5%',
  weatherClipPath: 'polygon(calc(3% + 2px) calc(2% + 2px), calc(98% - 2px) 2px, calc(96% - 2px) calc(96% - 2px), calc(1% + 2px) calc(93% - 2px))',
  width: '22.5%'
} as const satisfies VibeWindowGeometry

const AUTUMN_RAINY_BLUE_HOUR_WINDOW = {
  height: '55.8%',
  landscapeClipPath: 'polygon(0 2.2%, 100% 0, 100% 100%, 0 94.1%)',
  right: '4.5%',
  top: '5.7%',
  weatherClipPath: 'polygon(2px calc(2.2% + 2px), calc(100% - 2px) 2px, calc(100% - 2px) calc(100% - 2px), 2px calc(94.1% - 2px))',
  width: '21.9%'
} as const satisfies VibeWindowGeometry

const WINTER_SNOWY_NIGHT_WINDOW = {
  height: '56.2%',
  landscapeClipPath: 'polygon(0 3.2%, 100% 0, 100% 100%, 0 95.2%)',
  right: '4.4%',
  top: '4.8%',
  weatherClipPath: 'polygon(2px calc(3.2% + 2px), calc(100% - 2px) 2px, calc(100% - 2px) calc(100% - 2px), 2px calc(95.2% - 2px))',
  width: '23.6%'
} as const satisfies VibeWindowGeometry

const SCENE_PRESENTATION_BASE = {
  dark: {
    brightness: .78,
    contrast: 1,
    opacity: .62,
    saturation: .8
  },
  light: {
    brightness: 1,
    contrast: 1.03,
    opacity: .28,
    saturation: 1
  }
} as const

const SCENE_MASK_OPACITY = {
  dark: {
    sunrise: .84,
    morning: .9,
    noon: .9,
    afternoon: .88,
    sunset: .82,
    'blue-hour': .7,
    night: .58
  },
  light: {
    sunrise: .12,
    morning: .1,
    noon: .08,
    afternoon: .1,
    sunset: .12,
    'blue-hour': .14,
    night: .16
  }
} as const satisfies Record<
  'dark' | 'light',
  Record<VibeSolarPhase, number>
>

const SCENE_PRESENTATION_OVERRIDES: Partial<Record<
  VibeSceneId,
  VibeScene['presentation']
>> = {
  'autumn-rain-blue-hour': {
    dark: {
      brightness: .86,
      contrast: 1,
      maskOpacity: .82,
      opacity: .7,
      saturation: .84
    },
    light: {
      brightness: 1,
      contrast: 1.03,
      maskOpacity: .14,
      opacity: .3,
      saturation: 1
    }
  },
  'winter-snow-night': {
    dark: {
      brightness: .88,
      contrast: 1,
      maskOpacity: .8,
      opacity: .72,
      saturation: .82
    },
    light: {
      brightness: 1,
      contrast: 1.03,
      maskOpacity: .16,
      opacity: .31,
      saturation: .96
    }
  }
}

const SCENE_WINDOW_OVERRIDES: Partial<Record<
  VibeSceneId,
  VibeWindowGeometry
>> = {
  'autumn-rain-blue-hour': AUTUMN_RAINY_BLUE_HOUR_WINDOW,
  'winter-snow-night': WINTER_SNOWY_NIGHT_WINDOW
}

/**
 * Keeps bright scenes restrained while allowing authored night detail through.
 */
function getScenePresentation(
  sceneId: VibeSceneId,
  solarPhase: VibeSolarPhase
): VibeScene['presentation'] {
  const override = SCENE_PRESENTATION_OVERRIDES[sceneId]

  if (override !== undefined) {
    return override
  }

  return {
    dark: {
      ...SCENE_PRESENTATION_BASE.dark,
      maskOpacity: SCENE_MASK_OPACITY.dark[solarPhase]
    },
    light: {
      ...SCENE_PRESENTATION_BASE.light,
      maskOpacity: SCENE_MASK_OPACITY.light[solarPhase]
    }
  }
}

function getSceneId(
  season: VibeSeason,
  weather: VibeWeatherCondition,
  solarPhase: VibeSolarPhase
): VibeSceneId {
  return `${season}-${weather}-${solarPhase}`
}

function getSurfaceForWeather(
  weather: VibeWeatherCondition
): VibeSurfaceCondition {
  if (weather === 'snow') {
    return 'snow-covered'
  }

  if (weather === 'drizzle' || weather === 'rain' || weather === 'storm') {
    return 'wet'
  }

  return 'dry'
}

function createScene(
  season: VibeSeason,
  weather: VibeWeatherCondition,
  solarPhase: VibeSolarPhase
): [VibeSceneId, VibeScene] {
  const sceneId = getSceneId(season, weather, solarPhase)

  return [sceneId, {
    assets: {
      sceneSrcByTheme: {
        dark: getVibeSceneAssetPath(
          DEFAULT_VIBE_LANDSCAPE,
          season,
          weather,
          solarPhase,
          'dark'
        ),
        light: getVibeSceneAssetPath(
          DEFAULT_VIBE_LANDSCAPE,
          season,
          weather,
          solarPhase,
          'light'
        )
      },
      type: 'composite'
    },
    environment: {
      season,
      solarPhase,
      surface: getSurfaceForWeather(weather),
      weather
    },
    landscape: DEFAULT_VIBE_LANDSCAPE,
    presentation: getScenePresentation(sceneId, solarPhase),
    window: SCENE_WINDOW_OVERRIDES[sceneId] ?? SUMMER_CLEAR_NOON_WINDOW
  }]
}

/**
 * Complete scene catalog generated from the supported environment dimensions.
 */
export const VIBE_SCENES = Object.fromEntries(
  VIBE_SEASONS.flatMap((season) => (
    VIBE_WEATHER_CONDITIONS.flatMap((weather) => (
      VIBE_SOLAR_PHASES.map((solarPhase) => (
        createScene(season, weather, solarPhase)
      ))
    ))
  ))
) as Record<VibeSceneId, VibeScene>

export const DEFAULT_VIBE_SCENE_ID: VibeSceneId = 'winter-clear-night'

/**
 * Resolves the scene asset authored for the active theme.
 */
export function resolveVibeSceneAsset(
  scene: VibeScene,
  theme: Theme
): string {
  return scene.assets.sceneSrcByTheme[theme]
}
