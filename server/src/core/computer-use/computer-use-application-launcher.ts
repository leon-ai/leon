import path from 'node:path'

import type { ToolProviderExecutionInput } from '@/core/tool-provider/types'

import { COMPUTER_USE_LAUNCH_WINDOW_RETRY_DELAYS_MS } from './constants'
import type { ComputerUseDriver, CuaToolResult } from './types'
import { asRecord, hasText, parseJsonRecord } from './utils'

const APPLICATION_WINDOW_UNAVAILABLE_CODE = 'application_window_unavailable'

export interface ComputerUseLaunchResolution {
  errorCode?: string
  result: Record<string, unknown>
  ready: boolean
}

/** Waits for a launched desktop application to expose a usable window. */
export class ComputerUseApplicationLauncher {
  public async captureWindowBaseline(
    driver: ComputerUseDriver
  ): Promise<Map<string, Record<string, unknown>>> {
    const windows = await this.listWindows(driver, {})
    return new Map(
      windows.map((window) => [this.getWindowIdentity(window), window])
    )
  }

  public async resolve(
    driver: ComputerUseDriver,
    input: ToolProviderExecutionInput,
    parameters: Record<string, unknown>,
    launchResult: Record<string, unknown>,
    baseline: Map<string, Record<string, unknown>>
  ): Promise<ComputerUseLaunchResolution> {
    if (!Array.isArray(launchResult['windows'])) {
      return { result: launchResult, ready: true }
    }

    const launchedWindows = this.getWindows(launchResult)
    const pid = launchResult['pid']
    const identityTerms = this.getApplicationIdentityTerms(
      parameters,
      launchResult
    )
    const acceptsExistingWindowMutation =
      Array.isArray(parameters['urls']) && parameters['urls'].length > 0
    const reportedWindow = this.findLaunchedWindow(
      launchedWindows,
      baseline,
      typeof pid === 'number' ? pid : null,
      identityTerms,
      acceptsExistingWindowMutation
    )
    if (reportedWindow) {
      return {
        result: {
          ...launchResult,
          window_ready: true,
          windows: [reportedWindow]
        },
        ready: true
      }
    }

    input.onProgress?.({
      source: 'log',
      message: 'Waiting briefly for the application window to become ready.'
    })

    for (const delayMs of COMPUTER_USE_LAUNCH_WINDOW_RETRY_DELAYS_MS) {
      await this.sleep(delayMs)
      const windows = await this.listWindows(driver, {})
      const window = this.findLaunchedWindow(
        windows,
        baseline,
        typeof pid === 'number' ? pid : null,
        identityTerms,
        acceptsExistingWindowMutation
      )
      if (window) {
        return {
          result: {
            ...launchResult,
            window_ready: true,
            windows: [window]
          },
          ready: true
        }
      }
    }

    return {
      errorCode: APPLICATION_WINDOW_UNAVAILABLE_CODE,
      result: { ...launchResult, window_ready: false },
      ready: false
    }
  }

  private async listWindows(
    driver: ComputerUseDriver,
    parameters: Record<string, unknown>
  ): Promise<Array<Record<string, unknown>>> {
    const result = await driver.callTool(
      'list_windows',
      JSON.stringify({ on_screen_only: false, ...parameters })
    )
    if (result.isError || result.errorCode) {
      return []
    }

    return this.getWindows(this.parseResult(result))
  }

  private parseResult(result: CuaToolResult): Record<string, unknown> {
    return (
      parseJsonRecord(result.structuredJson) ||
      parseJsonRecord(result.rawJson) ||
      {}
    )
  }

  private getWindows(
    result: Record<string, unknown>
  ): Array<Record<string, unknown>> {
    const windows = result['windows']
    return Array.isArray(windows)
      ? windows
          .map(asRecord)
          .filter((window): window is Record<string, unknown> => window !== null)
      : []
  }

  private findLaunchedWindow(
    windows: Array<Record<string, unknown>>,
    baseline: Map<string, Record<string, unknown>>,
    pid: number | null,
    identityTerms: string[],
    acceptsExistingWindowMutation: boolean
  ): Record<string, unknown> | null {
    const exactProcessWindow =
      pid === null ? null : windows.find((window) => window['pid'] === pid)
    if (exactProcessWindow) {
      return exactProcessWindow
    }

    const matchingApplicationWindow = windows.find((window) =>
      this.windowMatchesApplication(window, identityTerms)
    )
    if (matchingApplicationWindow) {
      return matchingApplicationWindow
    }

    const newlyVisibleWindow = windows.find(
      (window) =>
        window['is_on_screen'] !== false &&
        !baseline.has(this.getWindowIdentity(window))
    )
    if (newlyVisibleWindow) {
      return newlyVisibleWindow
    }

    const newlyFocusedWindow = windows.find((window) => {
      const previous = baseline.get(this.getWindowIdentity(window))
      return (
        (window['active'] === true || window['focused'] === true) &&
        previous?.['active'] !== true &&
        previous?.['focused'] !== true
      )
    })
    if (newlyFocusedWindow) {
      return newlyFocusedWindow
    }

    if (!acceptsExistingWindowMutation) {
      return null
    }

    // OS URL handlers commonly reuse an existing app window. Prefer the
    // frontmost window whose title changed after launch instead of trusting an
    // unrelated window returned by the driver.
    return (
      windows
        .filter((window) => {
          const previous = baseline.get(this.getWindowIdentity(window))
          return previous && previous['title'] !== window['title']
        })
        .sort(
          (left, right) =>
            this.getWindowZIndex(right) - this.getWindowZIndex(left)
        )[0] || null
    )
  }

  private windowMatchesApplication(
    window: Record<string, unknown>,
    identityTerms: string[]
  ): boolean {
    if (identityTerms.length === 0) {
      return false
    }

    const windowIdentity = [window['app_name'], window['title']]
      .filter((value): value is string => hasText(value))
      .join(' ')
      .toLocaleLowerCase()
    return identityTerms.some((term) => windowIdentity.includes(term))
  }

  private getApplicationIdentityTerms(
    parameters: Record<string, unknown>,
    result: Record<string, unknown>
  ): string[] {
    const launchPath = parameters['launch_path']
    const launchCommand = hasText(launchPath)
      ? launchPath.trim().split(' ')[0]
      : null
    const values = [
      result['name'],
      result['bundle_id'],
      parameters['name'],
      parameters['bundle_id'],
      launchCommand ? this.getExecutableName(launchCommand) : null
    ]

    return [
      ...new Set(
        values
          .filter((value): value is string => hasText(value))
          .map((value) => value.trim().toLocaleLowerCase())
          .filter((value) => value.length > 1)
      )
    ]
  }

  private getExecutableName(command: string): string {
    const candidates = [path.posix.basename(command), path.win32.basename(command)]
    return candidates.sort((first, second) => first.length - second.length)[0]!
  }

  private getWindowIdentity(window: Record<string, unknown>): string {
    if (window['window_id'] !== undefined && window['window_id'] !== null) {
      return JSON.stringify(['window_id', window['window_id']])
    }

    return JSON.stringify([
      window['pid'],
      window['app_name'],
      window['title']
    ])
  }

  private getWindowZIndex(window: Record<string, unknown>): number {
    const zIndex = window['z_index']
    return typeof zIndex === 'number' && Number.isFinite(zIndex) ? zIndex : -1
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs)
    })
  }
}
