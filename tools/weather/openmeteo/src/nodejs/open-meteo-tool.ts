import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { Network, NetworkError } from '@sdk/network'

const DEFAULT_SETTINGS: Record<string, unknown> = {}
const REQUIRED_SETTINGS: string[] = []

const DEFAULT_FORECAST_DAYS = 1
const CURRENT_WEATHER_VARIABLES = [
  'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
  'weather_code', 'wind_speed_10m', 'wind_direction_10m'
]
const HOURLY_FORECAST_VARIABLES = [
  ...CURRENT_WEATHER_VARIABLES,
  'precipitation_probability',
  'precipitation'
]
const DAILY_FORECAST_VARIABLES = [
  'weather_code', 'temperature_2m_min', 'temperature_2m_max',
  'precipitation_sum', 'precipitation_probability_max', 'wind_speed_10m_max'
]

interface ForecastSeries {
  time: string[]
  weather_code: number[]
  [variable: string]: Array<string | number | null>
}

interface GeocodingResult {
  id: number
  name: string
  latitude: number
  longitude: number
  country?: string
  admin1?: string
}

interface GeocodingResponse {
  results?: GeocodingResult[]
}

interface CurrentWeather {
  temperature_2m: number
  relative_humidity_2m: number
  apparent_temperature: number
  weather_code: number
  wind_speed_10m: number
  wind_direction_10m: number
  time: string
}

interface WeatherResponse {
  latitude: number
  longitude: number
  current?: CurrentWeather
  daily?: ForecastSeries
  daily_units?: Record<string, string>
  hourly_units?: Record<string, string>
  timezone?: string
  utc_offset_seconds?: number
  hourly?: ForecastSeries
}

/**
 * A current timestamp formatted for both metric and imperial consumers.
 */
export interface WeatherConditions {
  location: string
  description: string
  temperatureC: string
  temperatureF: string
  feelsLikeC: string
  feelsLikeF: string
  humidity: string
  windKmph: string
  windMph: string
  windDirection: string
  observationTime: string
}

/**
 * Current conditions and complete forecasts share location and unit metadata.
 */
export interface WeatherData {
  location: string
  timezone: string | undefined
  utcOffsetSeconds: number | undefined
  current?: WeatherConditions
  dailyUnits: Record<string, string> | undefined
  hourlyUnits: Record<string, string> | undefined
  daily: ForecastSeries
  hourly: ForecastSeries
}

/**
 * Reports weather data or a concrete lookup failure.
 */
export interface WeatherResponseResult {
  success: boolean
  data?: WeatherData
  error?: string
  statusCode?: number
}

const WMO_CODE_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow fall',
  73: 'Moderate snow fall',
  75: 'Heavy snow fall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail'
}

const WIND_DIRECTIONS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW'
]

function degreesToCompass(degrees: number): string {
  const index = Math.round(degrees / 22.5) % 16
  return WIND_DIRECTIONS[index] ?? 'N'
}

function celsiusToFahrenheit(celsius: number): string {
  return Math.round((celsius * 9) / 5 + 32).toString()
}

function getWeatherDescription(code: number): string {
  return WMO_CODE_DESCRIPTIONS[code] || 'Unknown'
}

/**
 * Ensures Open-Meteo receives both boundaries for a requested interval.
 */
export function normalizeWeatherDateRange(
  startDate?: string,
  endDate?: string
): { startDate?: string, endDate?: string } {
  const suppliedBoundary = startDate || endDate

  return {
    startDate: startDate || suppliedBoundary,
    endDate: endDate || suppliedBoundary
  }
}

/**
 * Formats the provider's current timestamp independently from forecast hours.
 */
function formatCurrentConditions(
  current: CurrentWeather,
  location: string
): WeatherConditions {
  const temperature = Math.round(current.temperature_2m)
  const feelsLike = Math.round(current.apparent_temperature)
  const windSpeed = Math.round(current.wind_speed_10m)

  return {
    location,
    description: getWeatherDescription(current.weather_code),
    temperatureC: temperature.toString(),
    temperatureF: celsiusToFahrenheit(temperature),
    feelsLikeC: feelsLike.toString(),
    feelsLikeF: celsiusToFahrenheit(feelsLike),
    humidity: current.relative_humidity_2m.toString(),
    windKmph: windSpeed.toString(),
    windMph: Math.round(windSpeed * 0.621371).toString(),
    windDirection: degreesToCompass(current.wind_direction_10m),
    observationTime: current.time
  }
}

export default class OpenMeteoTool extends Tool {
  private static readonly TOOLKIT = 'weather'
  private readonly config: ReturnType<typeof ToolkitConfig.load>
  private readonly geocodingNetwork: Network
  private readonly weatherNetwork: Network

  constructor() {
    super()
    this.config = ToolkitConfig.load(OpenMeteoTool.TOOLKIT, this.toolName)
    const toolSettings = ToolkitConfig.loadToolSettings(
      OpenMeteoTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)
    this.geocodingNetwork = new Network({
      baseURL: 'https://geocoding-api.open-meteo.com'
    })
    this.weatherNetwork = new Network({ baseURL: 'https://api.open-meteo.com' })
  }

  get toolName(): string {
    return 'openmeteo'
  }

  get toolkit(): string {
    return OpenMeteoTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Returns current conditions and today's forecast, or a requested interval.
   */
  async getWeather(
    location: string,
    startDate?: string,
    endDate?: string
  ): Promise<WeatherResponseResult> {
    if (!location?.trim()) {
      return { success: false, error: 'Location is required.' }
    }

    try {
      const geocoding = await this.geocode(location.trim())
      if (!geocoding) {
        return { success: false, error: 'Location not found.' }
      }
      const weather = await this.fetchWeather(
        geocoding.latitude,
        geocoding.longitude,
        startDate,
        endDate
      )
      if (!weather.daily?.time?.length || !weather.hourly?.time?.length) {
        return { success: false, error: 'No forecast data available for this location.' }
      }

      return {
        success: true,
        data: {
          location: geocoding.displayName,
          timezone: weather.timezone,
          utcOffsetSeconds: weather.utc_offset_seconds,
          ...(weather.current
            ? {
                current: formatCurrentConditions(
                  weather.current,
                  geocoding.displayName
                )
              }
            : {}),
          dailyUnits: weather.daily_units,
          hourlyUnits: weather.hourly_units,
          daily: {
            ...weather.daily,
            description: weather.daily.weather_code.map(getWeatherDescription)
          },
          hourly: {
            ...weather.hourly,
            description: weather.hourly.weather_code.map(getWeatherDescription)
          }
        }
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to fetch weather: ${error instanceof Error ? error.message : String(error)}`,
        ...(error instanceof NetworkError
          ? { statusCode: error.response.statusCode }
          : {})
      }
    }
  }

  private async geocode(location: string): Promise<{
    latitude: number
    longitude: number
    displayName: string
  } | null> {
    const queryParams = new URLSearchParams({
      name: location,
      count: '1',
      language: 'en',
      format: 'json'
    }).toString()

    const response = await this.geocodingNetwork.request<GeocodingResponse>({
      url: `/v1/search?${queryParams}`,
      method: 'GET'
    })

    const results = response.data.results
    if (!results || results.length === 0) {
      return null
    }

    const result = results[0]!
    const parts = [result.name, result.admin1, result.country].filter(Boolean)

    return {
      latitude: result.latitude,
      longitude: result.longitude,
      displayName: parts.join(', ')
    }
  }

  private async fetchWeather(
    latitude: number,
    longitude: number,
    startDate?: string,
    endDate?: string
  ): Promise<WeatherResponse> {
    const normalizedDateRange = normalizeWeatherDateRange(startDate, endDate)
    const queryParams = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      timezone: 'auto'
    })

    queryParams.set('hourly', HOURLY_FORECAST_VARIABLES.join(','))
    queryParams.set('daily', DAILY_FORECAST_VARIABLES.join(','))
    if (normalizedDateRange.startDate && normalizedDateRange.endDate) {
      queryParams.set('start_date', normalizedDateRange.startDate)
      queryParams.set('end_date', normalizedDateRange.endDate)
    } else {
      queryParams.set('forecast_days', String(DEFAULT_FORECAST_DAYS))
      queryParams.set('current', CURRENT_WEATHER_VARIABLES.join(','))
    }

    const response = await this.weatherNetwork.request<WeatherResponse>({
      url: `/v1/forecast?${queryParams.toString()}`,
      method: 'GET'
    })

    return response.data
  }
}
