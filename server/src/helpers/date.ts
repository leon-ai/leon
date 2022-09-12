import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

import { TIME_ZONE } from '@/constants'
import log from '@/helpers/log'

dayjs.extend(utc)
dayjs.extend(timezone)

export function getDateTime() {
  return dayjs().tz(getTimeZone()).format()
}

export function getTimeZone() {
  let { timeZone } = Intl.DateTimeFormat().resolvedOptions()

  if (TIME_ZONE) {
    // Verify if the time zone is valid
    try {
      Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE })
      timeZone = TIME_ZONE
    } catch (e) {
      log.warning(
        `The time zone "${TIME_ZONE}" is not valid. Falling back to "${timeZone}"`
      )
    }
  }

  return timeZone
}
