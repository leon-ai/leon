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

export const VIBE_CUP_STATES = ['empty', 'still', 'steaming'] as const

export type VibeSeason = typeof VIBE_SEASONS[number]
export type VibeSolarPhase = typeof VIBE_SOLAR_PHASES[number]
export type VibeWeatherCondition = typeof VIBE_WEATHER_CONDITIONS[number]

export type VibeSurfaceCondition = 'dry' | 'wet' | 'snow-covered'
export type VibeCupState = typeof VIBE_CUP_STATES[number]

export interface VibeEnvironment {
  season: VibeSeason
  solarPhase: VibeSolarPhase
  surface: VibeSurfaceCondition
  weather: VibeWeatherCondition
}

export interface VibeInterior {
  cupState: VibeCupState
  lamp: {
    colorTemperatureKelvin: number
    intensity: number
    isOn: boolean
  }
}

interface VibeScenePresentation {
  brightness: number
  contrast: number
  maskOpacity: number
  opacity: number
  saturation: number
}

interface VibeCompositeAssets {
  sceneSrc: string
  type: 'composite'
}

interface VibeLayeredAssets {
  cupSrc: string
  keyboardSrc: string
  lampPlantSrc: string
  landscapeSrc: string
  roomDeskSrc: string
  type: 'layered'
  windowFrameSrc: string
}

type VibeSceneAssets = VibeCompositeAssets | VibeLayeredAssets

export interface VibeScene {
  assets: VibeSceneAssets
  environment: VibeEnvironment
  interior: VibeInterior
  presentation: {
    dark: VibeScenePresentation
    light: VibeScenePresentation
  }
}

export const VIBE_SCENES = {
  'summer-clear-noon': {
    assets: {
      cupSrc: '/img/vibes/layers/summer-clear-noon/cup.webp',
      keyboardSrc: '/img/vibes/layers/summer-clear-noon/keyboard.webp',
      lampPlantSrc: '/img/vibes/layers/summer-clear-noon/lamp-plant.webp',
      landscapeSrc: '/img/vibes/layers/summer-clear-noon/landscape.webp',
      roomDeskSrc: '/img/vibes/layers/summer-clear-noon/room-desk.webp',
      type: 'layered',
      windowFrameSrc: '/img/vibes/layers/summer-clear-noon/window-frame.webp'
    },
    environment: {
      season: 'summer',
      solarPhase: 'noon',
      surface: 'dry',
      weather: 'clear'
    },
    interior: {
      cupState: 'still',
      lamp: {
        colorTemperatureKelvin: 2_700,
        intensity: 0,
        isOn: false
      }
    },
    presentation: {
      dark: {
        brightness: .78,
        contrast: 1,
        maskOpacity: .9,
        opacity: .62,
        saturation: .8
      },
      light: {
        brightness: 1.05,
        contrast: .96,
        maskOpacity: .46,
        opacity: .76,
        saturation: .76
      }
    }
  },
  'autumn-rainy-blue-hour': {
    assets: {
      sceneSrc: '/img/vibes/proofs/autumn-rainy-blue-hour.webp',
      type: 'composite'
    },
    environment: {
      season: 'autumn',
      solarPhase: 'blue-hour',
      surface: 'wet',
      weather: 'rain'
    },
    interior: {
      cupState: 'steaming',
      lamp: {
        colorTemperatureKelvin: 2_400,
        intensity: .56,
        isOn: true
      }
    },
    presentation: {
      dark: {
        brightness: .86,
        contrast: 1,
        maskOpacity: .82,
        opacity: .7,
        saturation: .84
      },
      light: {
        brightness: 1.04,
        contrast: .9,
        maskOpacity: .56,
        opacity: .9,
        saturation: .72
      }
    }
  },
  'winter-snowy-night': {
    assets: {
      sceneSrc: '/img/vibes/proofs/winter-snowy-night.webp',
      type: 'composite'
    },
    environment: {
      season: 'winter',
      solarPhase: 'night',
      surface: 'snow-covered',
      weather: 'snow'
    },
    interior: {
      cupState: 'steaming',
      lamp: {
        colorTemperatureKelvin: 2_200,
        intensity: .82,
        isOn: true
      }
    },
    presentation: {
      dark: {
        brightness: .88,
        contrast: 1,
        maskOpacity: .8,
        opacity: .72,
        saturation: .82
      },
      light: {
        brightness: 1.05,
        contrast: .92,
        maskOpacity: .54,
        opacity: .9,
        saturation: .7
      }
    }
  }
} as const satisfies Record<string, VibeScene>

export type VibeSceneId = keyof typeof VIBE_SCENES

export const DEFAULT_VIBE_SCENE_ID: VibeSceneId = 'winter-snowy-night'
