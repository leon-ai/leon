import type {
  ActionFunction,
  ActionParams,
  BuiltInDateRangeEntity
} from '@sdk/types'
import { leon } from '@sdk/leon'

import { ONE_DAY_MILLISECONDS } from '../lib/constants'

const isBuiltInDateRangeEntity = (
  entity: ActionParams['current_entities'][number]
): entity is BuiltInDateRangeEntity => {
  return entity.entity === 'daterange'
}

/**
 * Calculate the number of days between two dates.
 * @example daysBetween(new Date(2020, 0, 1), new Date(2020, 0, 1)) // 0
 * @example daysBetween(new Date(2020, 0, 1), new Date(2020, 0, 2)) // 1
 */
const daysBetween = (date1: Date, date2: Date): number => {
  const differenceMilliseconds = Math.abs(date1.getTime() - date2.getTime())
  return Math.round(differenceMilliseconds / ONE_DAY_MILLISECONDS)
}

export const run: ActionFunction = async function (params) {
  let dateRangeEntity: BuiltInDateRangeEntity | null = null
  for (const entity of params.current_entities) {
    if (isBuiltInDateRangeEntity(entity)) {
      dateRangeEntity = entity
      break
    }
  }

  if (dateRangeEntity == null) {
    return await leon.answer({
      key: 'days_countdown_error'
    })
  }

  const currentDate = new Date()
  const futureDate = new Date(dateRangeEntity.resolution.futureEndDate)
  const daysCountdown = daysBetween(currentDate, futureDate)
  await leon.answer({
    key: 'days_countdown',
    data: {
      days: daysCountdown,
      month1: currentDate.toLocaleString(params.lang, { month: 'long' }),
      day1: currentDate.getDate(),
      year1: currentDate.getFullYear(),
      month2: futureDate.toLocaleString(params.lang, { month: 'long' }),
      day2: futureDate.getDate(),
      year2: futureDate.getFullYear()
    }
  })
}
