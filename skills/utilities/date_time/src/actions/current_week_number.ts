import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

import { format } from 'numerable'

const ONE_DAY_MILLISECONDS = 1_000 * 60 * 60 * 24

/**
 * Get the week number (1-52) for a given date.
 * @link https://stackoverflow.com/a/6117889/11571888
 * @example getWeekNumber(new Date(2020, 0, 1)) // 1
 * @example getWeekNumber(new Date(2020, 0, 8)) // 2
 */
const getWeekNumber = (date: Date): number => {
  const dateCopy = new Date(date.getTime())
  dateCopy.setHours(0, 0, 0, 0)
  dateCopy.setDate(dateCopy.getDate() + 3 - ((dateCopy.getDay() + 6) % 7))
  const week1 = new Date(dateCopy.getFullYear(), 0, 4)
  return (
    1 +
    Math.round(
      ((dateCopy.getTime() - week1.getTime()) / ONE_DAY_MILLISECONDS -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7
    )
  )
}

export const run: ActionFunction = async function () {
  const currentDate = new Date()
  const currentWeekNumber = getWeekNumber(currentDate)
  await leon.answer({
    key: 'current_week_number',
    data: {
      week_number: format(currentWeekNumber, '0o')
    }
  })
}
