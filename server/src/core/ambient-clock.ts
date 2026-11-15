// This module is shared with the browser and must stay free of server services.
const SUNRISE_START_HOUR = 6
const MORNING_START_HOUR = 8
const NOON_START_HOUR = 11
const AFTERNOON_START_HOUR = 14
const SUNSET_START_HOUR = 17
const BLUE_HOUR_START_HOUR = 19
const NIGHT_START_HOUR = 20

export enum AmbientSeason {
  Spring = 'spring',
  Summer = 'summer',
  Autumn = 'autumn',
  Winter = 'winter'
}

export enum AmbientSolarPhase {
  Sunrise = 'sunrise',
  Morning = 'morning',
  Noon = 'noon',
  Afternoon = 'afternoon',
  Sunset = 'sunset',
  BlueHour = 'blue-hour',
  Night = 'night'
}

export interface AmbientClockSnapshot {
  season: AmbientSeason
  solarPhase: AmbientSolarPhase
}

function getSeason(month: number): AmbientSeason {
  if (month >= 3 && month <= 5) {
    return AmbientSeason.Spring
  }

  if (month >= 6 && month <= 8) {
    return AmbientSeason.Summer
  }

  if (month >= 9 && month <= 11) {
    return AmbientSeason.Autumn
  }

  return AmbientSeason.Winter
}

/**
 * Derives a local scene when weather-location solar times are unavailable.
 */
export function getAmbientClock(
  date = new Date(),
  timeZone?: string
): AmbientClockSnapshot {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hourCycle: 'h23',
    month: 'numeric',
    ...(timeZone ? { timeZone } : {})
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)

  return {
    season: getSeason(month),
    solarPhase: getClockSolarPhase(hour)
  }
}

function getClockSolarPhase(hour: number): AmbientSolarPhase {
  // Keep a stable clock-based scene when today's solar times are unavailable.
  if (hour >= NIGHT_START_HOUR || hour < SUNRISE_START_HOUR) {
    return AmbientSolarPhase.Night
  }

  if (hour < MORNING_START_HOUR) {
    return AmbientSolarPhase.Sunrise
  }

  if (hour < NOON_START_HOUR) {
    return AmbientSolarPhase.Morning
  }

  if (hour < AFTERNOON_START_HOUR) {
    return AmbientSolarPhase.Noon
  }

  if (hour < SUNSET_START_HOUR) {
    return AmbientSolarPhase.Afternoon
  }

  if (hour < BLUE_HOUR_START_HOUR) {
    return AmbientSolarPhase.Sunset
  }

  return AmbientSolarPhase.BlueHour
}
