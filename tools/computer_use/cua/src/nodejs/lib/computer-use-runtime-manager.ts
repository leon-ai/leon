import { type CuaExecutionContext as ToolExecutionContext,
  ComputerUseInteractionMode,
  type ComputerUseActivityOverlayResolver,
  type ComputerUseDriver,
  type ComputerUseDriverFactory,
  type ComputerUseInteractionModeResolver,
  type ManagedComputerUseRuntime
} from './types'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { LogHelper } from '@/helpers/log-helper'

import { ComputerUseArtifactStore } from './computer-use-artifact-store'
import { COMPUTER_USE_SCREEN_CAPTURE_ACTIONS, CUA_FOREGROUND_DELIVERY_MODE } from './constants'
import { asRecord, hasCuaError } from './utils'

/**
 * Owns persistent driver instances and host-managed runtime parameters.
 */
export class ComputerUseRuntimeManager {
  private readonly runtimes = new Map<
    string,
    Promise<ManagedComputerUseRuntime>
  >()

  public constructor(
    private readonly driverFactory: ComputerUseDriverFactory,
    private readonly interactionModeResolver: ComputerUseInteractionModeResolver,
    private readonly activityOverlayResolver: ComputerUseActivityOverlayResolver,
    private readonly artifactStore: ComputerUseArtifactStore
  ) {}

  public async get(
    input: ToolExecutionContext
  ): Promise<ManagedComputerUseRuntime> {
    const { profileName } = input
    const existingRuntime = this.runtimes.get(profileName)
    if (existingRuntime) return existingRuntime

    // Keep native loading lazy so Leon starts on unsupported hosts.
    const runtimePromise = this.driverFactory(input).then(async (driver) => {
      if (!driver.isAvailable()) {
        await driver.shutdown()
        driver.uniffiDestroy()
        throw new Error('Computer use is not available on this computer.')
      }

      return {
        driver,
        initializedSessions: new Set<string>(),
        activityOverlaySessions: new Set<string>(),
        ...(await this.getActionCapabilities(driver))
      }
    })
    this.runtimes.set(profileName, runtimePromise)

    try {
      return await runtimePromise
    } catch (error) {
      this.runtimes.delete(profileName)
      throw error
    }
  }

  public async dispose(): Promise<void> {
    const runtimes = await Promise.allSettled(this.runtimes.values())
    this.runtimes.clear()

    await Promise.all(
      runtimes.map(async (result) => {
        if (result.status !== 'fulfilled') {
          return
        }
        try {
          await this.hideActivityOverlays(result.value)
          await result.value.driver.shutdown()
        } finally {
          result.value.driver.uniffiDestroy()
        }
      })
    )
  }

  /**
   * Hides activity after a serialized call without ending reusable Cua sessions.
   */
  public async finishExecution(profileName: string): Promise<void> {
    const pending = this.runtimes.get(profileName)
    if (!pending) return
    const runtime = await pending.catch(() => null)
    if (runtime) await this.hideActivityOverlays(runtime)
  }

  private async hideActivityOverlays(runtime: ManagedComputerUseRuntime): Promise<void> {
    // Native input can reveal its cursor even when the owner setting is off.
    // Hide every touched session instead of trusting cached visibility.
    for (const session of runtime.activityOverlaySessions) {
      if (!runtime.driver.setAgentCursorEnabled) continue
      try {
        const result = await runtime.driver.setAgentCursorEnabled({ session, enabled: false })
        if (hasCuaError(result)) throw new Error(result.text || result.errorCode)
        runtime.activityOverlaySessions.delete(session)
      } catch (error) {
        // Cleanup must not turn delivered input into a retryable action failure.
        // Retain the session so shutdown or the next call retries cleanup.
        LogHelper.warning(`Computer-use overlay cleanup failed: ${String(error)}`)
      }
    }
  }

  /**
   * Reapplies owner visibility after Cua revives an expired session.
   */
  public async restoreActivityOverlay(
    driver: ComputerUseDriver,
    input: ToolExecutionContext,
    session: string,
    action: string
  ): Promise<void> {
    await this.setActivityOverlay(
      driver,
      input,
      session,
      action
    )
  }

  public async prepareParameters(
    runtime: ManagedComputerUseRuntime,
    input: ToolExecutionContext,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    let managedParameters = { ...parameters }
    if (action === 'verify_state' && Array.isArray(managedParameters['expect'])) {
      // Preserve the predicate's meaning when the model flattens its selector.
      // Conflicting selectors must never be silently overwritten.
      managedParameters['expect'] = managedParameters['expect'].map((value: unknown) => {
        const predicate = asRecord(value)
        const element = asRecord(predicate?.['element'])
        if (!element) return value
        const normalized = { ...element }
        const selector = { ...asRecord(element['selector']) }
        for (const key of ['role', 'label_contains']) {
          if (element[key] === undefined) continue
          if (selector[key] !== undefined && selector[key] !== element[key]) {
            throw new Error(`Conflicting verify_state selector ${key}.`)
          }
          selector[key] = element[key]
          delete normalized[key]
        }
        return { ...predicate, element: { ...normalized, selector } }
      })
    }
    const hasElement = typeof managedParameters['element_index'] === 'number' ||
        (typeof managedParameters['element_token'] === 'string' &&
          managedParameters['element_token'].length > 0)
    if (['click', 'type_text', 'press_key', 'hotkey', 'scroll'].includes(action)) {
      const hasPixels = managedParameters['x'] != null || managedParameters['y'] != null
      if (hasElement && hasPixels) {
        throw new Error('Choose one target: a current element token/index OR screenshot pixels, not both.')
      }
      if (managedParameters['element_token'] === '' &&
          managedParameters['element_index'] != null) {
        throw new Error('An empty element token with an index is ambiguous. Supply only the intended current selector.')
      }
    }
    const target = asRecord(managedParameters['target'])
    if (['type_text', 'press_key', 'hotkey'].includes(action)) {
      const pid = target?.['pid'] ?? managedParameters['pid']
      const windowId = target?.['window_id'] ?? managedParameters['window_id']
      const validPid = Number.isInteger(pid) && Number(pid) > 0
      const validWindow = Number.isInteger(windowId) && Number(windowId) > 0
      const validTarget = target
        ? (target['kind'] === 'window' && validPid && validWindow) ||
          (target['kind'] === 'desktop' && typeof target['display_id'] === 'string' && Boolean(target['display_id']))
        : managedParameters['scope'] === 'desktop' ||
          ((validPid || validWindow) && (pid === undefined || validPid) && (windowId === undefined || validWindow))
      if (!validTarget) {
        throw new Error('Keyboard input requires an explicit target from the latest observation. Supply target={kind:"window",pid,window_id}; do not rely on global focus or pid 0.')
      }
    }
    if (hasElement) {
      const pid = target?.['pid'] ?? managedParameters['pid']
      const windowId = target?.['window_id'] ?? managedParameters['window_id']
      // A snapshot token is not a process target. Require the observed window
      // explicitly rather than guessing from whichever application is active.
      if (!Number.isInteger(pid) || Number(pid) <= 0 ||
          !Number.isInteger(windowId) || Number(windowId) <= 0) {
        throw new Error('Element input requires pid and window_id from the same fresh get_window_state observation. Supply those fields (or an exact window target) with the current element token.')
      }
    }
    if (target?.['kind'] === 'window') {
      // Cua accepts either target or legacy window fields, never both.
      // Models sometimes repeat the same target in both representations.
      for (const key of ['pid', 'window_id']) {
        const legacyValue = managedParameters[key]
        if (legacyValue != null && legacyValue !== target[key]) {
          throw new Error(
            `Conflicting computer-use ${key}; select one exact window.`
          )
        }
        delete managedParameters[key]
      }
      if (managedParameters['scope'] === 'desktop') {
        throw new Error('A window target cannot use desktop coordinates.')
      }
      delete managedParameters['scope']
      managedParameters['target'] = {
        kind: 'window',
        pid: target['pid'],
        window_id: target['window_id']
      }
    }
    if (target?.['kind'] === 'desktop') {
      // Accept duplicate representations only when they identify the same
      // desktop; never silently reinterpret window coordinates as global input.
      if ((managedParameters['scope'] != null && managedParameters['scope'] !== 'desktop') ||
          ['pid', 'window_id', 'element_index', 'snapshot_id'].some((key) =>
            managedParameters[key] != null || target[key] != null) || hasElement) {
        throw new Error('A desktop target cannot include window scope, identifiers, or element selectors.')
      }
      if (managedParameters['display_id'] != null &&
          managedParameters['display_id'] !== target['display_id']) {
        throw new Error('Conflicting computer-use display_id; select one exact desktop.')
      }
      delete managedParameters['scope']
      delete managedParameters['display_id']
    }
    for (const key of ['element_token', 'snapshot_id']) {
      if (managedParameters[key] === '') delete managedParameters[key]
    }
    if (action === 'clipboard_write' && typeof managedParameters['text'] === 'string') {
      for (const key of ['file_path', 'image_path']) {
        if (managedParameters[key] === '') delete managedParameters[key]
      }
    }
    if (action === 'list_windows' && managedParameters['pid'] === 0) {
      delete managedParameters['pid']
    }
    const interactionMode = this.interactionModeResolver(input)
    if (
      interactionMode === ComputerUseInteractionMode.Visible &&
      runtime.foregroundCapableActions.has(action)
    ) {
      // Cua owns activation, exact-window validation and focus restoration.
      managedParameters['delivery_mode'] = CUA_FOREGROUND_DELIVERY_MODE
    }

    if (action === 'start_recording') {
      const recordingDirectory = path.join(
        this.artifactStore.getArtifactDirectory(input),
        'recordings',
        `${Date.now()}-${randomUUID()}`
      )
      await fs.promises.mkdir(recordingDirectory, { recursive: true })
      managedParameters = {
        ...managedParameters,
        output_dir: recordingDirectory
      }
    }

    if (!runtime.sessionAwareActions.has(action)) {
      return managedParameters
    }

    // One stable hidden label resumes Cua state throughout the conversation.
    const sessionSource =
      input.conversationSessionId || `${input.profileName}:unscoped`
    const session = `leon-${createHash('sha256')
      .update(sessionSource)
      .digest('hex')
      .slice(0, 12)}`
    if (!runtime.initializedSessions.has(session)) {
      const sessionResult = await runtime.driver.callTool(
        'start_session',
        JSON.stringify({ session })
      )
      if (hasCuaError(sessionResult)) {
        throw new Error(
          sessionResult.text ||
            sessionResult.errorCode ||
            'Unable to start the computer-use session.'
        )
      }
      runtime.initializedSessions.add(session)
    }

    await this.configureActivityOverlay(runtime, input, session, action)

    return { ...managedParameters, session }
  }

  private async configureActivityOverlay(
    runtime: ManagedComputerUseRuntime,
    input: ToolExecutionContext,
    session: string,
    action: string
  ): Promise<void> {
    if (
      !runtime.driver.setAgentCursorEnabled ||
      runtime.activityOverlaySessions.has(session)
    ) {
      return
    }

    // Track intent before the native call so cleanup also runs if it throws.
    runtime.activityOverlaySessions.add(session)
    await this.setActivityOverlay(
      runtime.driver,
      input,
      session,
      action
    )
  }

  private async setActivityOverlay(
    driver: ComputerUseDriver,
    input: ToolExecutionContext,
    session: string,
    action: string
  ): Promise<void> {
    if (!driver.setAgentCursorEnabled) {
      return
    }

    // An animated cursor is useful during input, but pollutes observation
    // hashes and can cover the control the model needs to read.
    const enabled = !COMPUTER_USE_SCREEN_CAPTURE_ACTIONS.has(action) &&
      action !== 'verify_state' && this.activityOverlayResolver(input)
    const result = await driver.setAgentCursorEnabled({ session, enabled })
    if (hasCuaError(result)) {
      input.onProgress?.({
        source: 'log',
        message: 'The computer-use activity overlay is unavailable on this host.'
      })
    }
  }

  private async getActionCapabilities(
    driver: ComputerUseDriver
  ): Promise<
    Pick<
      ManagedComputerUseRuntime,
      'sessionAwareActions' | 'foregroundCapableActions' | 'zoomCapableActions'
    >
  > {
    const catalog = asRecord(JSON.parse(await driver.listToolsJson()))
    const tools = Array.isArray(catalog?.['tools']) ? catalog['tools'] : []
    const sessionAwareActions = new Set<string>()
    const foregroundCapableActions = new Set<string>()
    const zoomCapableActions = new Set<string>()

    for (const tool of tools) {
      const toolRecord = asRecord(tool)
      const inputSchema = asRecord(toolRecord?.['inputSchema'])
      const properties = asRecord(inputSchema?.['properties'])
      const name = toolRecord?.['name']
      if (typeof name !== 'string') {
        continue
      }
      if (properties?.['session']) {
        sessionAwareActions.add(name)
      }
      if (properties?.['delivery_mode']) {
        foregroundCapableActions.add(name)
      }
      if (properties?.['from_zoom']) {
        zoomCapableActions.add(name)
      }
    }

    return { sessionAwareActions, foregroundCapableActions, zoomCapableActions }
  }
}
