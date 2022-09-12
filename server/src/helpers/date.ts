import moment from 'moment-timezone'

import { TIME_ZONE } from '@/constants'

export function getDateTime() {
  return moment().tz(getTimeZone()).format()
}

export function getTimeZone() {
  let timeZone = moment.tz.guess()

  if (TIME_ZONE && !!moment.tz.zone(TIME_ZONE)) {
    timeZone = TIME_ZONE
  }

  return timeZone
}
