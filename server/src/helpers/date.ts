import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

import { TIME_ZONE } from '@/constants'
import { log } from '@/helpers/log'

dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * Get date time
 *
 * @example getDateTime() // 2022-09-12T12:42:57+08:00
 */
export function getDateTime() {
  return dayjs().tz(getTimeZone()).format()
}

/**
 * Get time zone
 *
 * @example getTimeZone() // Asia/Shanghai
 */
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
