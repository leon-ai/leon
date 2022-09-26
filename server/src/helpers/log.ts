import fs from 'node:fs'
import path from 'node:path'

import { IS_TESTING_ENV } from '@/constants'
import { DateHelper } from '@/helpers/date-helper'

class LogHelper {
  static readonly ERRORS_PATH = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'logs',
    'errors.log'
  )

  private static instance: LogHelper

  constructor() {
    if (LogHelper.instance == null) {
      LogHelper.instance = this
    }
  }

  /**
   * This one looks obvious :)
   */
  public success(value: string) {
    console.log('\x1b[32m✅ %s\x1b[0m', value)
  }

  /**
   * This one looks obvious :)
   */
  public info(value: string) {
    console.info('\x1b[36mℹ️  %s\x1b[0m', value)
  }

  /**
   * This one looks obvious :)
   */
  public warning(value: string) {
    console.warn('\x1b[33m⚠️  %s\x1b[0m', value)
  }

  /**
   * This one looks obvious :)
   */
  public debug(value: string) {
    console.info('\u001b[35m🐞 [DEBUG] %s\x1b[0m', value)
  }

  /**
   * Log message on stderr and write in error log file
   */
  public error(value: string) {
    const data = `${DateHelper.getDateTime()} - ${value}`

    if (!IS_TESTING_ENV) {
      if (fs.existsSync(LogHelper.ERRORS_PATH)) {
        fs.appendFileSync(LogHelper.ERRORS_PATH, `\n${data}`)
      } else {
        fs.writeFileSync(LogHelper.ERRORS_PATH, data, { flag: 'wx' })
      }
    }

    console.error('\x1b[31m🚨 %s\x1b[0m', value)
  }

  /**
   * This one looks obvious :)
   */
  public title(value: string) {
    console.log('\n\n\x1b[7m.: %s :.\x1b[0m', value.toUpperCase())
  }

  /**
   * This one looks obvious :)
   */
  public default(value: string) {
    console.log(value)
  }
}

export const LOG = new LogHelper()
