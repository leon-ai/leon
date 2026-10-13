import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import OpenMeteoTool from '@tools/weather/openmeteo'
import { WeatherForecastWidget } from '../widgets/weather-forecast-widget'

type Units = 'metric' | 'imperial'

const formatTemperature = (value: string, unit: Units): string => {
  if (!value) {
    return 'N/A'
  }

  return unit === 'imperial' ? `${value}°F` : `${value}°C`
}

const formatWind = (speed: string, direction: string, unit: Units): string => {
  if (!speed) {
    return 'N/A'
  }

  const label = unit === 'imperial' ? `${speed} mph` : `${speed} km/h`

  return direction ? `${label} ${direction}` : label
}

/**
 * Converts forecast values from the tool's Celsius units for native answers.
 */
function formatForecastTemperature(value: unknown, unit: Units): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  const temperature = unit === 'imperial' ? (value * 9) / 5 + 32 : value

  return formatTemperature(Math.round(temperature).toString(), unit)
}

export const run: ActionFunction = async function (
  _params,
  paramsHelper: ParamsHelper
) {
  const location = paramsHelper.getActionArgument('location') as string
  const startDate = paramsHelper.getActionArgument('start_date') as
    | string
    | undefined
  const endDate = paramsHelper.getActionArgument('end_date') as
    | string
    | undefined
  const units =
    ((paramsHelper.getActionArgument('units') as Units) || 'metric') ===
    'imperial'
      ? 'imperial'
      : 'metric'

  if (!location) {
    leon.answer({
      key: 'forecast_error',
      data: {
        location: 'that location',
        error: 'Location is required.'
      }
    })
    return
  }

  try {
    const weatherTool = await ToolManager.initTool(OpenMeteoTool)
    const result = await weatherTool.getWeather(
      location,
      startDate,
      endDate
    )

    if (!result.success || !result.data) {
      const errorMessage = result.error || 'Unknown weather service error.'
      const isNotFound =
        errorMessage.toLowerCase().includes('not found') ||
        errorMessage.toLowerCase().includes('no weather data') ||
        errorMessage.toLowerCase().includes('not available')

      leon.answer({
        key: isNotFound ? 'location_not_found' : 'forecast_error',
        data: {
          location,
          error: errorMessage
        }
      })
      return
    }

    const weather = result.data
    const current = weather.current
    if (!current) {
      // Dated requests describe each requested day rather than treating the
      // first hourly forecast as an observation of current conditions.
      const forecast = weather.daily.time.map((date, index) => {
        const minimum = formatForecastTemperature(
          weather.daily['temperature_2m_min']?.[index],
          units
        )
        const maximum = formatForecastTemperature(
          weather.daily['temperature_2m_max']?.[index],
          units
        )
        const rainProbability = weather.daily['precipitation_probability_max']?.[index]
        const wind = weather.daily['wind_speed_10m_max']?.[index]
        const description = weather.daily['description']?.[index] || 'Unknown'
        const details = [`${date}: ${description}`, `${minimum}–${maximum}`]

        if (typeof rainProbability === 'number') {
          details.push(`${rainProbability}% rain chance`)
        }
        if (typeof wind === 'number') {
          const speed = units === 'imperial' ? wind * 0.621371 : wind
          const formattedWind = formatWind(
            Math.round(speed).toString(),
            '',
            units
          )

          details.push(`wind up to ${formattedWind}`)
        }

        return details.join(', ')
      }).join('\n')

      await leon.answer({
        key: 'forecast_interval_summary',
        data: {
          location: weather.location || location,
          forecast
        }
      })
      return
    }

    const temperature =
      units === 'imperial'
        ? formatTemperature(current.temperatureF, units)
        : formatTemperature(current.temperatureC, units)
    const feelsLike =
      units === 'imperial'
        ? formatTemperature(current.feelsLikeF, units)
        : formatTemperature(current.feelsLikeC, units)
    const humidity = current.humidity ? `${current.humidity}%` : 'N/A'
    const windSpeed =
      units === 'imperial'
        ? formatWind(current.windMph, current.windDirection, units)
        : formatWind(current.windKmph, current.windDirection, units)

    const widget = new WeatherForecastWidget({
      params: {
        location: weather.location || location,
        description: current.description,
        temperature,
        feelsLike,
        humidity,
        wind: windSpeed,
        observationTime: current.observationTime
      }
    })

    await leon.answer({
      widget,
      key: 'forecast_summary',
      data: {
        location: weather.location || location,
        description: current.description,
        temperature,
        feels_like: feelsLike,
        humidity,
        wind: windSpeed
      }
    })
  } catch (error: unknown) {
    if (isMissingToolSettingsError(error)) {
      return
    }
    throw error
  }
}
