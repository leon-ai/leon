import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

import { zeroPad } from '../lib/zeroPad'

export const run: ActionFunction = async function (params) {
  const currentDate = new Date()
  await leon.answer({
    key: 'current_date_time',
    data: {
      weekday: currentDate.toLocaleString(params.lang, { weekday: 'long' }),
      month: currentDate.toLocaleString(params.lang, { month: 'long' }),
      day: currentDate.getDate(),
      year: currentDate.getFullYear(),
      hours: zeroPad(currentDate.getHours()),
      minutes: zeroPad(currentDate.getMinutes()),
      seconds: zeroPad(currentDate.getSeconds())
    }
  })
}
