import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'

import { CONFIG_MANAGER } from '@/config'
import { LogHelper } from '@/helpers/log-helper'

dayjs.extend(utc)
dayjs.extend(timezone)

export class DateHelper {
  /**
   * Get date time
   * @example getDateTime() // 2022-09-12T12:42:57+08:00
   */
  public static getDateTime(date?: string | number | Date | null): string {
    const dateTime =
      typeof date === 'undefined' || date === null || date === ''
        ? dayjs()
        : dayjs(date)

    if (!dateTime.isValid()) {
      return ''
    }

    return dateTime.tz(this.getTimeZone()).format()
  }

  /**
   * Get friendly date
   * @example setFriendlyDate() // Thursday, May 23, 2024
   */
  public static setFriendlyDate(date: Date): string {
    return dayjs(date).tz(this.getTimeZone()).format('dddd, MMMM D, YYYY')
  }

  /**
   * Get time zone
   * @example getTimeZone() // Asia/Shanghai
   */
  public static getTimeZone(): string {
    let { timeZone } = Intl.DateTimeFormat().resolvedOptions()
    const configuredTimeZone = CONFIG_MANAGER.getConfig().time_zone

    if (configuredTimeZone) {
      // Verify if the time zone is valid
      try {
        Intl.DateTimeFormat(undefined, { timeZone: configuredTimeZone })
        timeZone = configuredTimeZone
      } catch (e) {
        LogHelper.warning(
          `The time zone "${configuredTimeZone}" is not valid. Falling back to "${timeZone}". Details: ${e}`
        )
      }
    }

    return timeZone
  }
}
