import { lazy, Suspense } from 'react'
import type { VibeWeatherCondition } from '../vibes-scenes'
import { WEATHER_ANIMATIONS } from './weather-config'

const WeatherLayer = lazy(() => import('./weather-layer').then((module) => ({ default: module.WeatherLayer })).catch(() => ({
  // Decorative downloads must not replace the surrounding conversation on failure.
  default: function UnavailableWeather() {
    return null
  }
})))

/**
 * Keeps decorative canvas code out of clear-sky startup without delaying scenes.
 */
export function LazyWeatherLayer({ weather }: { weather: VibeWeatherCondition }) {
  if (!WEATHER_ANIMATIONS[weather]) {
    return null
  }

  return <Suspense fallback={null}><WeatherLayer weather={weather} /></Suspense>
}
