import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

import { TIME_ZONE } from '@/constants'
import { LOG } from '@/helpers/log'

dayjs.extend(utc)
dayjs.extend(timezone)

class DateHelper {
  private static instance: DateHelper

  constructor() {
    if (DateHelper.instance == null) {
      DateHelper.instance = this
    }
  }

  /**
   * Get date time
   * @example getDateTime() // 2022-09-12T12:42:57+08:00
   */
  public getDateTime() {
    return dayjs().tz(this.getTimeZone()).format()
  }

  /**
   * Get time zone
   * @example getTimeZone() // Asia/Shanghai
   */
  public getTimeZone() {
    let { timeZone } = Intl.DateTimeFormat().resolvedOptions()

    if (TIME_ZONE) {
      // Verify if the time zone is valid
      try {
        Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE })
        timeZone = TIME_ZONE
      } catch (e) {
        LOG.warning(
          `The time zone "${TIME_ZONE}" is not valid. Falling back to "${timeZone}"`
        )
      }
    }

    return timeZone as string
  }
}

export const DATE = new DateHelper()
