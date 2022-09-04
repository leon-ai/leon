import moment from 'moment-timezone'

import { TIME_ZONE } from '@/constants'

const date = {}

date.dateTime = () => moment().tz(date.timeZone()).format()

date.timeZone = () => {
  let timeZone = moment.tz.guess()

  if (TIME_ZONE && !!moment.tz.zone(TIME_ZONE)) {
    timeZone = TIME_ZONE
  }

  return timeZone
}

export default date
