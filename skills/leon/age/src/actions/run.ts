import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

import { getTimeDifferenceBetweenDates } from '../lib/getTimeDifferenceBetweenDates'

const LEON_BIRTH_DATE = new Date('2019-02-10T20:29:00+08:00')

export const run: ActionFunction = async function (params) {
  const answers = ['alive_for', 'magical_day', 'commemorate'] as const
  const answer = answers[Math.floor(Math.random() * answers.length)]

  if (answer === 'magical_day') {
    return leon.answer({
      key: 'magical_day',
      data: {
        weekday: LEON_BIRTH_DATE.toLocaleString(params.lang, {
          weekday: 'long'
        }),
        month: LEON_BIRTH_DATE.toLocaleString(params.lang, { month: 'long' }),
        day: LEON_BIRTH_DATE.getDate(),
        year: LEON_BIRTH_DATE.getFullYear()
      }
    })
  }

  if (answer === 'commemorate') {
    return leon.answer({
      key: 'commemorate',
      data: {
        month: LEON_BIRTH_DATE.toLocaleString(params.lang, { month: 'long' }),
        day: LEON_BIRTH_DATE.getDate(),
        year: LEON_BIRTH_DATE.getFullYear()
      }
    })
  }

  const currentDate = new Date()
  const { years, months, days, hours, minutes, seconds } =
    getTimeDifferenceBetweenDates(currentDate, LEON_BIRTH_DATE)
  await leon.answer({
    key: 'alive_for',
    data: {
      years,
      months,
      days,
      hours,
      minutes,
      seconds
    }
  })
}
