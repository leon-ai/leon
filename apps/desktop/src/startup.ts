import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserWindow } from 'electron'

const FAILED_NAVIGATION_CODE = -2
const NETWORK_RECOVERY_DELAY_MS = 500

/**
 * Gives Chromium one bounded retry for ERR_FAILED during its network-service
 * restart. Other failures propagate immediately; successful startup adds no delay.
 */
export async function loadClientURL(target: Pick<BrowserWindow, 'loadURL' | 'isDestroyed'>, url: string): Promise<void> {
  try {
    await target.loadURL(url)
  } catch (error) {
    if (!(error instanceof Error) || !('errno' in error) || error.errno !== FAILED_NAVIGATION_CODE || target.isDestroyed()) {
      throw error
    }
    await delay(NETWORK_RECOVERY_DELAY_MS)
    if (target.isDestroyed()) {
      throw error
    }
    await target.loadURL(url)
  }
}
