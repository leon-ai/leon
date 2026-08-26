import {
  DEFAULT_VIBE_SCENE_ID,
  VIBE_SCENES,
  type VibeEnvironment,
  type VibeScene,
  type VibeSceneId,
  type VibeSeason,
  type VibeSolarPhase,
  type VibeSurfaceCondition,
  type VibeWeatherCondition
} from './vibes-scenes'

const SEASON_FALLBACKS: Record<VibeSeason, readonly VibeSeason[]> = {
  spring: ['spring', 'summer', 'autumn', 'winter'],
  summer: ['summer', 'spring', 'autumn', 'winter'],
  autumn: ['autumn', 'summer', 'winter', 'spring'],
  winter: ['winter', 'autumn', 'spring', 'summer']
}

const SOLAR_PHASE_FALLBACKS: Record<
  VibeSolarPhase,
  readonly VibeSolarPhase[]
> = {
  sunrise: [
    'sunrise',
    'morning',
    'blue-hour',
    'noon',
    'afternoon',
    'sunset',
    'night'
  ],
  morning: [
    'morning',
    'sunrise',
    'noon',
    'afternoon',
    'sunset',
    'blue-hour',
    'night'
  ],
  noon: [
    'noon',
    'morning',
    'afternoon',
    'sunrise',
    'sunset',
    'blue-hour',
    'night'
  ],
  afternoon: [
    'afternoon',
    'noon',
    'sunset',
    'morning',
    'blue-hour',
    'sunrise',
    'night'
  ],
  sunset: [
    'sunset',
    'blue-hour',
    'afternoon',
    'night',
    'noon',
    'morning',
    'sunrise'
  ],
  'blue-hour': [
    'blue-hour',
    'sunset',
    'night',
    'sunrise',
    'afternoon',
    'morning',
    'noon'
  ],
  night: [
    'night',
    'blue-hour',
    'sunset',
    'sunrise',
    'afternoon',
    'morning',
    'noon'
  ]
}

const WEATHER_FALLBACKS: Record<
  VibeWeatherCondition,
  readonly VibeWeatherCondition[]
> = {
  clear: [
    'clear',
    'partly-cloudy',
    'overcast',
    'fog',
    'drizzle',
    'rain',
    'storm',
    'snow'
  ],
  'partly-cloudy': [
    'partly-cloudy',
    'clear',
    'overcast',
    'fog',
    'drizzle',
    'rain',
    'storm',
    'snow'
  ],
  overcast: [
    'overcast',
    'partly-cloudy',
    'fog',
    'drizzle',
    'rain',
    'clear',
    'storm',
    'snow'
  ],
  fog: [
    'fog',
    'overcast',
    'drizzle',
    'partly-cloudy',
    'rain',
    'clear',
    'snow',
    'storm'
  ],
  drizzle: [
    'drizzle',
    'rain',
    'overcast',
    'fog',
    'partly-cloudy',
    'storm',
    'clear',
    'snow'
  ],
  rain: [
    'rain',
    'drizzle',
    'storm',
    'overcast',
    'fog',
    'partly-cloudy',
    'snow',
    'clear'
  ],
  storm: [
    'storm',
    'rain',
    'drizzle',
    'overcast',
    'fog',
    'snow',
    'partly-cloudy',
    'clear'
  ],
  snow: [
    'snow',
    'overcast',
    'storm',
    'rain',
    'drizzle',
    'fog',
    'partly-cloudy',
    'clear'
  ]
}

const SURFACE_FALLBACKS: Record<
  VibeSurfaceCondition,
  readonly VibeSurfaceCondition[]
> = {
  dry: ['dry', 'wet', 'snow-covered'],
  wet: ['wet', 'dry', 'snow-covered'],
  'snow-covered': ['snow-covered', 'wet', 'dry']
}

export type VibeEnvironmentInput = Partial<VibeEnvironment>

export interface VibeSceneResolution {
  isExactMatch: boolean
  requestedEnvironment: VibeEnvironment
  scene: VibeScene
  sceneId: VibeSceneId
}

function getFallbackRank<T extends string>(
  requestedValue: T,
  candidateValue: T,
  fallbacks: Record<T, readonly T[]>
): number {
  const rank = fallbacks[requestedValue].indexOf(candidateValue)

  return rank === -1 ? fallbacks[requestedValue].length : rank
}

function compareScores(
  first: readonly number[],
  second: readonly number[]
): number {
  for (let index = 0; index < first.length; index += 1) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0)

    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

function getSceneScore(
  requested: VibeEnvironment,
  candidate: VibeEnvironment
): readonly number[] {
  return [
    getFallbackRank(requested.season, candidate.season, SEASON_FALLBACKS),
    getFallbackRank(requested.weather, candidate.weather, WEATHER_FALLBACKS),
    getFallbackRank(
      requested.solarPhase,
      candidate.solarPhase,
      SOLAR_PHASE_FALLBACKS
    ),
    getFallbackRank(requested.surface, candidate.surface, SURFACE_FALLBACKS)
  ]
}

function environmentsMatch(
  first: VibeEnvironment,
  second: VibeEnvironment
): boolean {
  return first.season === second.season &&
    first.solarPhase === second.solarPhase &&
    first.surface === second.surface &&
    first.weather === second.weather
}

/** Returns the surface state implied by precipitation. */
export function getVibeSurfaceForWeather(
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

/** Normalizes partial environmental data against the current default scene. */
export function normalizeVibeEnvironment(
  environment: VibeEnvironmentInput = {}
): VibeEnvironment {
  const defaultEnvironment = VIBE_SCENES[DEFAULT_VIBE_SCENE_ID].environment
  const weather = environment.weather ?? defaultEnvironment.weather

  return {
    season: environment.season ?? defaultEnvironment.season,
    solarPhase: environment.solarPhase ?? defaultEnvironment.solarPhase,
    surface: environment.surface ?? getVibeSurfaceForWeather(weather),
    weather
  }
}

/** Resolves requested conditions to the closest available scene artwork. */
export function resolveVibeScene(
  environment: VibeEnvironmentInput = {}
): VibeSceneResolution {
  const requestedEnvironment = normalizeVibeEnvironment(environment)
  const sceneEntries = Object.entries(VIBE_SCENES) as Array<[
    VibeSceneId,
    VibeScene
  ]>
  let bestSceneId: VibeSceneId = DEFAULT_VIBE_SCENE_ID
  let bestScene: VibeScene = VIBE_SCENES[DEFAULT_VIBE_SCENE_ID]
  let bestScore = getSceneScore(requestedEnvironment, bestScene.environment)

  for (const [candidateId, candidate] of sceneEntries) {
    const candidateScore = getSceneScore(
      requestedEnvironment,
      candidate.environment
    )

    if (compareScores(candidateScore, bestScore) < 0) {
      bestSceneId = candidateId
      bestScene = candidate
      bestScore = candidateScore
    }
  }

  return {
    isExactMatch: environmentsMatch(
      requestedEnvironment,
      bestScene.environment
    ),
    requestedEnvironment,
    scene: bestScene,
    sceneId: bestSceneId
  }
}
