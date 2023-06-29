import type { ActionFunction, SpacyLocationCityEntity } from '@sdk/types'
import { leon } from '@sdk/leon'

import { zeroPad } from '../lib/zeroPad'

/**
 * Determine if the given date is in Daylight Saving Time (DST).
 * @example isDaylightSavingTime(new Date(2020, 0, 1)) // false
 * @example isDaylightSavingTime(new Date(2020, 7, 1)) // true
 */
function isDaylightSavingTime(date: Date): boolean {
  const january = new Date(date.getFullYear(), 0, 1).getTimezoneOffset()
  const july = new Date(date.getFullYear(), 6, 1).getTimezoneOffset()
  return Math.max(january, july) !== date.getTimezoneOffset()
}

/**
 * Get the current date in Coordinated Universal Time (UTC).
 */
function getCurrentCoordinatedUniversalTime(): Date {
  const currentDate = new Date()
  const utcOffset = currentDate.getTimezoneOffset()
  currentDate.setMinutes(currentDate.getMinutes() + utcOffset)
  return currentDate
}

export const run: ActionFunction = async function (params) {
  let cityEntity: SpacyLocationCityEntity | null = null
  for (const entity of params.current_entities) {
    if (entity.type === 'location:city') {
      cityEntity = entity
      break
    }
  }

  if (cityEntity == null) {
    return await leon.answer({
      key: 'city_not_found'
    })
  }

  const { time_zone } = cityEntity.resolution.data

  const currentDate = getCurrentCoordinatedUniversalTime()
  if (isDaylightSavingTime(currentDate)) {
    currentDate.setHours(
      currentDate.getHours() + time_zone.daylight_saving_time_offset
    )
  } else {
    currentDate.setHours(
      currentDate.getHours() + time_zone.coordinated_universal_time_offset
    )
  }

  await leon.answer({
    key: 'current_date_time_with_time_zone',
    data: {
      weekday: currentDate.toLocaleString(params.lang, { weekday: 'long' }),
      month: currentDate.toLocaleString(params.lang, { month: 'long' }),
      day: currentDate.getDate(),
      year: currentDate.getFullYear(),
      hours: zeroPad(currentDate.getHours()),
      minutes: zeroPad(currentDate.getMinutes()),
      seconds: zeroPad(currentDate.getSeconds()),
      city: cityEntity.resolution.data.name,
      country: time_zone.country_code
    }
  })
}
