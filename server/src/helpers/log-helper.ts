import fs from 'node:fs'
import path from 'node:path'

import { DateHelper } from '@/helpers/date-helper'

export class LogHelper {
  static readonly ERRORS_FILE_PATH = path.join(
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

    if (fs.existsSync(this.ERRORS_FILE_PATH)) {
      fs.appendFileSync(this.ERRORS_FILE_PATH, `\n${data}`)
    } else {
      fs.writeFileSync(this.ERRORS_FILE_PATH, data, { flag: 'wx' })
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

  /**
   * Parse error logs and return an array of log errors
   * @example parseErrorLogs() // 'Failed to connect to the TCP server: Error: read ECONNRESET'
   */
  public static async parseErrorLogs(): Promise<string[]> {
    if (!fs.existsSync(LogHelper.ERRORS_FILE_PATH)) {
      await fs.promises.open(LogHelper.ERRORS_FILE_PATH, 'w')
    }

    const errorFileContent = await fs.promises.readFile(
      LogHelper.ERRORS_FILE_PATH,
      'utf8'
    )
    const errorLogs = errorFileContent
      .trim()
      .split(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} - /)

    // Remove the first empty string if there's one
    if (errorLogs[0] === '') {
      errorLogs.shift()
    }

    return errorLogs
  }
}
