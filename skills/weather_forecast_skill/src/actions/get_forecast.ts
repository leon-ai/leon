import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import OpenMeteoTool from '@tools/weather/openmeteo'
import { WeatherForecastWidget } from '../widgets/weather-forecast-widget'

type Units = 'metric' | 'imperial'

const formatTemperature = (value: string, unit: Units): string => {
  if (!value) return 'N/A'
  return unit === 'imperial' ? `${value}°F` : `${value}°C`
}

const formatWind = (speed: string, direction: string, unit: Units): string => {
  if (!speed) return 'N/A'
  const label = unit === 'imperial' ? `${speed} mph` : `${speed} km/h`
  return direction ? `${label} ${direction}` : label
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
    const result = await weatherTool.getCurrentConditions(
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

    const temperature =
      units === 'imperial'
        ? formatTemperature(result.data.temperatureF, units)
        : formatTemperature(result.data.temperatureC, units)
    const feelsLike =
      units === 'imperial'
        ? formatTemperature(result.data.feelsLikeF, units)
        : formatTemperature(result.data.feelsLikeC, units)
    const humidity = result.data.humidity ? `${result.data.humidity}%` : 'N/A'
    const windSpeed =
      units === 'imperial'
        ? formatWind(result.data.windMph, result.data.windDirection, units)
        : formatWind(result.data.windKmph, result.data.windDirection, units)

    const widget = new WeatherForecastWidget({
      params: {
        location: result.data.location || location,
        description: result.data.description,
        temperature,
        feelsLike,
        humidity,
        wind: windSpeed,
        observationTime: result.data.observationTime
      }
    })

    await leon.answer({
      widget,
      key: 'forecast_summary',
      data: {
        location: result.data.location || location,
        description: result.data.description,
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
