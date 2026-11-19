import { UPDATE_SERVICE } from '@/core/ota/update-service'
import { LogHelper } from '@/helpers/log-helper'
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_JITTER_MS } from '@@/bridges/runtime/contracts/update-status.js'

/**
 * Shares scheduled release checks with the browser's explicit update action.
 */
export class Updater {
  private static timer: NodeJS.Timeout | undefined

  /**
   * Spaces discovery independently of UI polling and spreads owners' requests.
   */
  public static start(): void {
    clearTimeout(this.timer)
    const run = async (): Promise<void> => {
      await this.checkForUpdates()
      this.timer = setTimeout(() => {
        void run()
      }, UPDATE_CHECK_INTERVAL_MS + Math.floor(Math.random() * UPDATE_CHECK_JITTER_MS))
      this.timer.unref()
    }
    void run()
  }

  /**
   * Keeps background failures in server logs; explicit checks use request feedback.
   */
  public static async checkForUpdates(): Promise<void> {
    try {
      const check = await UPDATE_SERVICE.check()
      if (check.release) {
        LogHelper.info(`A new version is available: ${check.release.version}`)
      }
    } catch (e) {
      LogHelper.warning(`Failed to check for updates: ${e}`)
    }
  }
}
