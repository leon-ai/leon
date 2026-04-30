import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'

import { zeroPad } from '../lib/zeroPad'

export const run: ActionFunction = async function (params) {
  const timeZone = params.action_arguments['time_zone']
  const locationName =
    typeof params.action_arguments['location_name'] === 'string'
      ? params.action_arguments['location_name']
      : null

  if (typeof timeZone !== 'string') {
    await leon.answer({
      key: 'time_zone_not_found'
    })
    return
  }

  try {
    Intl.DateTimeFormat('en', { timeZone })
  } catch {
    await leon.answer({
      key: 'time_zone_not_found'
    })
    return
  }

  const currentDate = new Date(new Date().toLocaleString('en', { timeZone }))
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
      location_name: locationName || timeZone,
      time_zone: timeZone
    }
  })
}
