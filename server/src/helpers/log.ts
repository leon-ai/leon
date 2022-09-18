import fs from 'node:fs'
import path from 'node:path'

import { IS_TESTING_ENV } from '@/constants'
import { getDateTime } from '@/helpers/date'

/**
 * Log Singleton Class.
 */
export class Log {
  static readonly ERRORS_PATH = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'logs',
    'errors.log'
  )
  private static instance: Log

  private constructor() {
    // Singleton
  }

  public static getInstance(): Log {
    if (Log.instance == null) {
      Log.instance = new Log()
    }
    return Log.instance
  }

  public success(value: string): void {
    console.log('\x1b[32m✅ %s\x1b[0m', value)
  }

  public info(value: string): void {
    console.info('\x1b[36mℹ️  %s\x1b[0m', value)
  }

  public warning(value: string): void {
    console.warn('\x1b[33m⚠️  %s\x1b[0m', value)
  }

  public debug(value: string): void {
    console.info('\u001b[35m🐞 [DEBUG] %s\x1b[0m', value)
  }

  public error(value: string): void {
    const data = `${getDateTime()} - ${value}`
    if (!IS_TESTING_ENV) {
      if (fs.existsSync(Log.ERRORS_PATH)) {
        fs.appendFileSync(Log.ERRORS_PATH, `\n${data}`)
      } else {
        fs.writeFileSync(Log.ERRORS_PATH, data, { flag: 'wx' })
      }
    }
    console.error('\x1b[31m🚨 %s\x1b[0m', value)
  }

  public title(value: string): void {
    console.log('\n\n\x1b[7m.: %s :.\x1b[0m', value.toUpperCase())
  }

  public default(value: string): void {
    console.log(value)
  }
}

export const log = Log.getInstance()
