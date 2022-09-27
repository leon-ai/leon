import fs from 'node:fs'
import path from 'node:path'

import { IS_TESTING_ENV } from '@/constants'
import { DateHelper } from '@/helpers/date-helper'

export class LogHelper {
  static readonly ERRORS_PATH = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'logs',
    'errors.log'
  )

  /**
   * This one looks obvious :)
   */
  public static success(value: string): void {
    console.log('\x1b[32m✅ %s\x1b[0m', value)
  }

  /**
   * This one looks obvious :)
   */
  public static info(value: string): void {
    console.info('\x1b[36mℹ️  %s\x1b[0m', value)
  }

  /**
   * This one looks obvious :)
   */
  public static warning(value: string): void {
    console.warn('\x1b[33m⚠️  %s\x1b[0m', value)
  }

  /**
   * This one looks obvious :)
   */
  public static debug(value: string): void {
    console.info('\u001b[35m🐞 [DEBUG] %s\x1b[0m', value)
  }

  /**
   * Log message on stderr and write in error log file
   */
  public static error(value: string): void {
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
  public static title(value: string): void {
    console.log('\n\n\x1b[7m.: %s :.\x1b[0m', value.toUpperCase())
  }

  /**
   * This one looks obvious :)
   */
  public static default(value: string): void {
    console.log(value)
  }

  /**
   * Start a log timer
   */
  public static time(value: string): void {
    console.time(`🕑 \x1b[36m${value}\x1b[0m`)
  }

  /**
   * Stop log timer
   */
  public static timeEnd(value: string): void {
    console.timeEnd(`🕑 \x1b[36m${value}\x1b[0m`)
  }
}
