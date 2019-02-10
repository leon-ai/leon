'use strict'

import moment from 'moment-timezone'

const date = { }

date.dateTime = () => moment().tz(date.timeZone()).format()

date.timeZone = () => {
  let timeZone = moment.tz.guess()

  if (process.env.LEON_TIME_ZONE && !!moment.tz.zone(process.env.LEON_TIME_ZONE)) {
    timeZone = process.env.LEON_TIME_ZONE
  }

  return timeZone
}

export default date
