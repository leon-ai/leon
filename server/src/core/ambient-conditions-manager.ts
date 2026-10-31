import {
  TOOLKIT_REGISTRY,
  TOOL_EXECUTOR
} from '@/core'
import { ContextStateStore } from '@/core/context-manager/context-state-store'
import { readOwnerProfileSync } from '@/core/context-manager/owner-profile'
import { DateHelper } from '@/helpers/date-helper'
import { LogHelper } from '@/helpers/log-helper'
import { ToolExecutionOrigin } from '@/types'
import dayjs from 'dayjs'

export const AMBIENT_WEATHER_REFRESH_INTERVAL_MS = 60 * 60 * 1_000

const AMBIENT_WEATHER_RETRY_INTERVAL_MS = 10 * 60 * 1_000
const SUNRISE_START_HOUR = 6
const MORNING_START_HOUR = 8
const NOON_START_HOUR = 11
const AFTERNOON_START_HOUR = 14
const SUNSET_START_HOUR = 17
const BLUE_HOUR_START_HOUR = 19
const NIGHT_START_HOUR = 20
const SOLAR_TRANSITION_WINDOW_MS = 30 * 60 * 1_000
const SOLAR_DATE_FORMAT = 'YYYY-MM-DD'

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

export enum AmbientWeatherCondition {
  Clear = 'clear',
  PartlyCloudy = 'partly-cloudy',
  Overcast = 'overcast',
  Fog = 'fog',
  Drizzle = 'drizzle',
  Rain = 'rain',
  Storm = 'storm',
  Snow = 'snow'
}

/**
 * Open-Meteo.com weather code mapping
 * @see https://open-meteo.com/en/docs#weather_variable_documentation
 */
const WEATHER_CONDITIONS_BY_WMO_CODE: Readonly<Record<number, AmbientWeatherCondition>> = {
  0: AmbientWeatherCondition.Clear,
  1: AmbientWeatherCondition.Clear,
  2: AmbientWeatherCondition.PartlyCloudy,
  3: AmbientWeatherCondition.Overcast,
  45: AmbientWeatherCondition.Fog,
  48: AmbientWeatherCondition.Fog,
  51: AmbientWeatherCondition.Drizzle,
  53: AmbientWeatherCondition.Drizzle,
  55: AmbientWeatherCondition.Drizzle,
  56: AmbientWeatherCondition.Drizzle,
  57: AmbientWeatherCondition.Drizzle,
  61: AmbientWeatherCondition.Rain,
  63: AmbientWeatherCondition.Rain,
  65: AmbientWeatherCondition.Rain,
  66: AmbientWeatherCondition.Rain,
  67: AmbientWeatherCondition.Rain,
  71: AmbientWeatherCondition.Snow,
  73: AmbientWeatherCondition.Snow,
  75: AmbientWeatherCondition.Snow,
  77: AmbientWeatherCondition.Snow,
  80: AmbientWeatherCondition.Rain,
  81: AmbientWeatherCondition.Rain,
  82: AmbientWeatherCondition.Rain,
  85: AmbientWeatherCondition.Snow,
  86: AmbientWeatherCondition.Snow,
  95: AmbientWeatherCondition.Storm,
  96: AmbientWeatherCondition.Storm,
  99: AmbientWeatherCondition.Storm
}

export interface AmbientWeatherSnapshot {
  condition: AmbientWeatherCondition
  description: string
  feelsLikeC: number
  fetchedAt: number
  location: string
  observationTime: string
  temperatureC: number
  weatherCode: number
  solar?: AmbientSolarTimes | null
}

export interface AmbientSolarTimes {
  date: string
  timeZone: string
  sunrise: number
  sunset: number
}

export interface AmbientConditionsSnapshot {
  season: AmbientSeason
  solarPhase: AmbientSolarPhase
  timeZone: string
  weather: AmbientWeatherSnapshot | null
}

interface AmbientConditionsCacheState {
  locationQuery: string | null
  weather: AmbientWeatherSnapshot | null
}

interface WeatherToolResult {
  success?: boolean
  data?: {
    location?: string
    timezone?: string
    daily?: {
      time?: string[]
      sunrise?: (string | null)[]
      sunset?: (string | null)[]
    }
    current?: {
      description?: string
      feelsLikeC?: string
      observationTime?: string
      temperatureC?: string
      weatherCode?: number
    }
  }
}

const EMPTY_AMBIENT_CONDITIONS_CACHE_STATE: AmbientConditionsCacheState = {
  locationQuery: null,
  weather: null
}

/**
 * Owns the profile's shared weather cache and derives local ambient time state.
 */
export default class AmbientConditionsManager {
  private readonly cacheStore = new ContextStateStore<AmbientConditionsCacheState>(
    '.ambient-conditions-cache.json',
    EMPTY_AMBIENT_CONDITIONS_CACHE_STATE
  )
  private lastWeatherAttemptAt: number | null = null
  private pendingWeatherRefresh: Promise<void> | null = null
  private locationQuery: string | null = null
  private weather: AmbientWeatherSnapshot | null = null

  public constructor() {
    const cache = this.cacheStore.load()

    this.locationQuery = cache.locationQuery
    this.weather = cache.weather

    LogHelper.title('Ambient Conditions Manager')
    LogHelper.success('New instance')
  }

  /**
   * Return current local conditions, refreshing stale weather when appropriate.
   */
  public async getSnapshot(date = new Date()): Promise<AmbientConditionsSnapshot> {
    await this.refreshWeatherIfNeeded()

    const timeZone = this.weather?.solar?.timeZone ?? DateHelper.getTimeZone()
    const localDateParts = this.getLocalDateParts(date, timeZone)

    return {
      season: this.getSeason(localDateParts.month),
      solarPhase: this.getSolarPhase(date, localDateParts.hour),
      timeZone,
      weather: this.weather
    }
  }

  private getOwnerLocationQuery(): string {
    const ownerProfile = readOwnerProfileSync()
    const city = ownerProfile.owner_current_city?.trim() || ''
    const country = ownerProfile.owner_current_country?.trim() || ''

    if (city && country) {
      return `${city}, ${country}`
    }

    if (city) {
      return city
    }

    const timeZone = DateHelper.getTimeZone()

    // Only geographic zones can supply a city when the owner has no location.
    if (!Intl.supportedValuesOf('timeZone').includes(timeZone)) {
      return ''
    }

    const parts = timeZone.split('/').filter(Boolean)

    return (parts[parts.length - 1] || '').replaceAll('_', ' ').trim()
  }

  private async refreshWeatherIfNeeded(): Promise<void> {
    const locationQuery = this.getOwnerLocationQuery()

    if (!locationQuery) {
      this.locationQuery = null
      this.weather = null
      return
    }

    if (locationQuery !== this.locationQuery) {
      this.locationQuery = locationQuery
      this.weather = null
      this.lastWeatherAttemptAt = null
    }

    const now = Date.now()
    const isWeatherFresh = this.weather !== null &&
      this.weather.solar !== undefined &&
      now - this.weather.fetchedAt < AMBIENT_WEATHER_REFRESH_INTERVAL_MS &&
      (!this.weather.solar || this.weather.solar.date ===
        dayjs(now).tz(this.weather.solar.timeZone).format(SOLAR_DATE_FORMAT))
    const shouldWaitBeforeRetry = this.lastWeatherAttemptAt !== null &&
      now - this.lastWeatherAttemptAt < AMBIENT_WEATHER_RETRY_INTERVAL_MS

    if (isWeatherFresh || shouldWaitBeforeRetry) {
      return
    }

    if (!this.pendingWeatherRefresh) {
      this.pendingWeatherRefresh = this.refreshWeather(locationQuery)
        .finally(() => {
          this.pendingWeatherRefresh = null
        })
    }

    await this.pendingWeatherRefresh
  }

  private async refreshWeather(locationQuery: string): Promise<void> {
    this.lastWeatherAttemptAt = Date.now()

    try {
      if (!TOOLKIT_REGISTRY.isLoaded) {
        await TOOLKIT_REGISTRY.load()
      }

      const execution = await TOOL_EXECUTOR.executeTool({
        origin: ToolExecutionOrigin.Persona,
        toolkitId: 'weather',
        toolId: 'openmeteo',
        functionName: 'getWeather',
        parsedInput: {
          location: locationQuery
        }
      })

      if (execution.status !== 'success') {
        this.logWeatherRefreshFailure(execution.message)
        return
      }

      const toolResult = execution.data.output['result'] as
        | WeatherToolResult
        | undefined
      const weather = this.parseWeatherSnapshot(toolResult, locationQuery)

      if (!weather) {
        this.logWeatherRefreshFailure('Open-Meteo returned incomplete data.')
        return
      }

      // A location change during the request must not publish stale-city data.
      if (this.getOwnerLocationQuery() !== locationQuery) {
        return
      }

      this.locationQuery = locationQuery
      this.weather = weather
      this.cacheStore.save({
        locationQuery,
        weather
      })
    } catch (error) {
      this.logWeatherRefreshFailure(String(error))
    }
  }

  private parseWeatherSnapshot(
    toolResult: WeatherToolResult | undefined,
    locationQuery: string
  ): AmbientWeatherSnapshot | null {
    const current = toolResult?.data?.current

    if (!toolResult?.success || !current) {
      return null
    }

    const weatherCode = Number(current.weatherCode)
    const temperatureC = Number(current.temperatureC)
    const feelsLikeC = Number(current.feelsLikeC)
    const condition = WEATHER_CONDITIONS_BY_WMO_CODE[weatherCode]
    const observationTime = current.observationTime || ''

    if (
      condition === undefined ||
      !Number.isFinite(temperatureC) ||
      !Number.isFinite(feelsLikeC) ||
      !observationTime
    ) {
      return null
    }

    return {
      condition,
      description: current.description || 'Unknown',
      feelsLikeC,
      fetchedAt: Date.now(),
      location: toolResult.data?.location || locationQuery,
      observationTime,
      temperatureC,
      weatherCode,
      // Cache unavailable solar data too, so ordinary weather freshness still applies.
      solar: this.parseSolarTimes(toolResult.data) ?? null
    }
  }

  private parseSolarTimes(data: WeatherToolResult['data']): AmbientSolarTimes | undefined {
    const date = data?.daily?.time?.[0]
    const sunrise = data?.daily?.sunrise?.[0]
    const sunset = data?.daily?.sunset?.[0]
    const timeZone = data?.timezone
    if (!date || !sunrise || !sunset || !timeZone) {
      return undefined
    }

    try {
      // Forecast timestamps are local to the weather location, not the server.
      const rise = dayjs.tz(sunrise, timeZone)
      const set = dayjs.tz(sunset, timeZone)
      if (!rise.isValid() || !set.isValid() || set.valueOf() <= rise.valueOf() ||
        rise.format(SOLAR_DATE_FORMAT) !== date || set.format(SOLAR_DATE_FORMAT) !== date) {
        return undefined
      }

      return { date, timeZone, sunrise: rise.valueOf(), sunset: set.valueOf() }
    } catch {
      // Missing/polar-day data or invalid zones must not discard usable weather.
      return undefined
    }
  }

  private getLocalDateParts(
    date: Date,
    timeZone: string
  ): { hour: number, month: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hourCycle: 'h23',
      month: 'numeric',
      timeZone
    }).formatToParts(date)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value)
    const month = Number(parts.find((part) => part.type === 'month')?.value)

    return {
      hour: Number.isInteger(hour) ? hour : date.getHours(),
      month: Number.isInteger(month) ? month : date.getMonth() + 1
    }
  }

  private getSeason(month: number): AmbientSeason {
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

  private getSolarPhase(date: Date, hour: number): AmbientSolarPhase {
    const solar = this.weather?.solar
    if (solar && dayjs(date).tz(solar.timeZone).format(SOLAR_DATE_FORMAT) === solar.date) {
      const now = date.getTime()
      const daylight = solar.sunset - solar.sunrise
      const transition = Math.min(SOLAR_TRANSITION_WINDOW_MS, daylight / 6)
      const noon = (solar.sunrise + solar.sunset) / 2

      // Artistic dawn/dusk windows follow real solar events; daylight phases
      // scale with day length rather than assuming fixed local clock hours.
      if (now < solar.sunrise - transition || now >= solar.sunset + transition * 3) {
        return AmbientSolarPhase.Night
      }
      if (now < solar.sunrise + transition) {
        return AmbientSolarPhase.Sunrise
      }
      if (now < noon - daylight / 12) {
        return AmbientSolarPhase.Morning
      }
      if (now < noon + daylight / 12) {
        return AmbientSolarPhase.Noon
      }
      if (now < solar.sunset - transition) {
        return AmbientSolarPhase.Afternoon
      }
      if (now < solar.sunset + transition) {
        return AmbientSolarPhase.Sunset
      }

      return AmbientSolarPhase.BlueHour
    }

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

  private logWeatherRefreshFailure(message: string): void {
    LogHelper.title('Ambient Conditions Manager')
    LogHelper.warning(`Weather refresh failed: ${message}`)
  }
}
