import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { Network, NetworkError } from '@sdk/network'

const DEFAULT_SETTINGS: Record<string, unknown> = {}
const REQUIRED_SETTINGS: string[] = []

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

interface HourlyWeather {
  time: string[]
  temperature_2m: number[]
  relative_humidity_2m: number[]
  apparent_temperature: number[]
  weather_code: number[]
  wind_speed_10m: number[]
  wind_direction_10m: number[]
}

interface WeatherResponse {
  latitude: number
  longitude: number
  current?: CurrentWeather
  hourly?: HourlyWeather
  current_units?: {
    temperature_2m: string
    relative_humidity_2m: string
    apparent_temperature: string
    weather_code: string
    wind_speed_10m: string
    wind_direction_10m: string
  }
}

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

export interface WeatherResponseResult {
  success: boolean
  data?: WeatherConditions
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

function mapHourlyToCurrent(hourly: HourlyWeather): CurrentWeather | null {
  if (!hourly.time || hourly.time.length === 0) {
    return null
  }

  const index = 0

  const temperature = hourly.temperature_2m?.[index]
  const humidity = hourly.relative_humidity_2m?.[index]
  const apparentTemperature = hourly.apparent_temperature?.[index]
  const weatherCode = hourly.weather_code?.[index]
  const windSpeed = hourly.wind_speed_10m?.[index]
  const windDirection = hourly.wind_direction_10m?.[index]
  const time = hourly.time[index]

  if (
    temperature === undefined ||
    humidity === undefined ||
    apparentTemperature === undefined ||
    weatherCode === undefined ||
    windSpeed === undefined ||
    windDirection === undefined ||
    !time
  ) {
    return null
  }

  return {
    temperature_2m: temperature,
    relative_humidity_2m: humidity,
    apparent_temperature: apparentTemperature,
    weather_code: weatherCode,
    wind_speed_10m: windSpeed,
    wind_direction_10m: windDirection,
    time
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

  async getCurrentConditions(
    location: string,
    startDate?: string,
    endDate?: string
  ): Promise<WeatherResponseResult> {
    if (!location || !location.trim()) {
      return {
        success: false,
        error: 'Location is required.'
      }
    }

    try {
      const geocodingResult = await this.geocode(location.trim())
      if (!geocodingResult) {
        return {
          success: false,
          error: 'Location not found.'
        }
      }

      const weather = await this.fetchWeather(
        geocodingResult.latitude,
        geocodingResult.longitude,
        startDate,
        endDate
      )

      if (!weather.current) {
        return {
          success: false,
          error: 'No weather data available for this location.'
        }
      }

      const current = weather.current
      const tempC = Math.round(current.temperature_2m)
      const feelsLikeC = Math.round(current.apparent_temperature)
      const windKmph = Math.round(current.wind_speed_10m)

      return {
        success: true,
        data: {
          location: geocodingResult.displayName,
          description: getWeatherDescription(current.weather_code),
          temperatureC: tempC.toString(),
          temperatureF: celsiusToFahrenheit(tempC),
          feelsLikeC: feelsLikeC.toString(),
          feelsLikeF: celsiusToFahrenheit(feelsLikeC),
          humidity: current.relative_humidity_2m.toString(),
          windKmph: windKmph.toString(),
          windMph: Math.round(windKmph * 0.621371).toString(),
          windDirection: degreesToCompass(current.wind_direction_10m),
          observationTime: current.time
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const statusCode =
        error instanceof NetworkError ? error.response.statusCode : undefined

      return {
        success: false,
        error: `Failed to fetch weather: ${message}`,
        statusCode
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
    const queryParams = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      timezone: 'auto'
    })

    if (startDate || endDate) {
      queryParams.set(
        'hourly',
        'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m'
      )
      if (startDate) {
        queryParams.set('start_date', startDate)
      }
      if (endDate) {
        queryParams.set('end_date', endDate)
      }
    } else {
      queryParams.set(
        'current',
        'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m'
      )
    }

    const response = await this.weatherNetwork.request<WeatherResponse>({
      url: `/v1/forecast?${queryParams.toString()}`,
      method: 'GET'
    })

    const weatherData = response.data
    if (!weatherData.current && weatherData.hourly) {
      const mappedCurrent = mapHourlyToCurrent(weatherData.hourly)
      if (mappedCurrent) {
        weatherData.current = mappedCurrent
      }
    }

    return weatherData
  }
}
