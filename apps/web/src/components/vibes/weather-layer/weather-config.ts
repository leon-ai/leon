import type { VibeWeatherCondition } from '../vibes-scenes'

export type WeatherAnimationKind = 'rain' | 'snow'

export interface WeatherAnimationConfig {
  density: number
  glassDensity: number
  kind: WeatherAnimationKind
  opacity: number
  seed: number
  speed: number
}

export const WEATHER_ANIMATIONS: Partial<
  Record<VibeWeatherCondition, WeatherAnimationConfig>
> = {
  drizzle: {
    density: .9,
    glassDensity: .48,
    kind: 'rain',
    opacity: .62,
    seed: 1_021,
    speed: .4
  },
  rain: {
    density: 1.6,
    glassDensity: 1,
    kind: 'rain',
    opacity: 1,
    seed: 2_047,
    speed: .55
  },
  storm: {
    density: 2,
    glassDensity: 1.25,
    kind: 'rain',
    opacity: 1.15,
    seed: 4_093,
    speed: .78
  },
  snow: {
    density: 1.65,
    glassDensity: .8,
    kind: 'snow',
    opacity: 1,
    seed: 8_191,
    speed: .68
  }
}

