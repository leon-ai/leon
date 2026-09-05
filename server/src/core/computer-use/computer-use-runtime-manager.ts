import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { ToolProviderExecutionInput } from '@/core/tool-provider/types'

import { ComputerUseArtifactStore } from './computer-use-artifact-store'
import { CUA_FOREGROUND_DELIVERY_MODE } from './constants'
import {
  ComputerUseInteractionMode,
  type ComputerUseDriver,
  type ComputerUseDriverFactory,
  type ComputerUseInteractionModeResolver,
  type ManagedComputerUseRuntime
} from './types'
import { asRecord, hasCuaError } from './utils'

/** Owns persistent driver instances and host-managed runtime parameters. */
export class ComputerUseRuntimeManager {
  private readonly runtimes = new Map<
    string,
    Promise<ManagedComputerUseRuntime>
  >()

  public constructor(
    private readonly driverFactory: ComputerUseDriverFactory,
    private readonly interactionModeResolver: ComputerUseInteractionModeResolver,
    private readonly artifactStore: ComputerUseArtifactStore
  ) {}

  public async get(profileName: string): Promise<ManagedComputerUseRuntime> {
    const existingRuntime = this.runtimes.get(profileName)
    if (existingRuntime) {
      return existingRuntime
    }

    // Keep native loading lazy so Leon starts on unsupported hosts.
    const runtimePromise = this.driverFactory().then(async (driver) => {
      if (!driver.isAvailable()) {
        await driver.shutdown()
        driver.uniffiDestroy()
        throw new Error('Computer use is not available on this computer.')
      }

      return {
        driver,
        initializedSessions: new Set<string>(),
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
        await result.value.driver.shutdown()
        result.value.driver.uniffiDestroy()
      })
    )
  }

  public async prepareParameters(
    runtime: ManagedComputerUseRuntime,
    input: ToolProviderExecutionInput,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    let managedParameters = { ...parameters }
    if (['click', 'type_text', 'press_key', 'hotkey', 'scroll'].includes(action)) {
      const hasElement = typeof managedParameters['element_index'] === 'number' ||
        (typeof managedParameters['element_token'] === 'string' &&
          managedParameters['element_token'].length > 0)
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
    const hasElement = typeof managedParameters['element_index'] === 'number' ||
      (typeof managedParameters['element_token'] === 'string' &&
        managedParameters['element_token'].length > 0)
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
    if (action === 'browser_prepare') {
      const strategy = asRecord(managedParameters['strategy'])
      if (strategy?.['kind'] === 'existing_profile') {
        const profile = asRecord(managedParameters['profile'])
        // These optional defaults must not select the incompatible isolated
        // launch route when an existing-profile strategy was requested.
        if (managedParameters['allow_launch'] === false) {
          delete managedParameters['allow_launch']
        }
        if (profile?.['mode'] === 'isolated_new' && !profile['name']) {
          delete managedParameters['profile']
        }
        if (managedParameters['allow_launch'] != null || managedParameters['profile'] != null) {
          throw new Error('Choose either strategy=existing_profile with pid/window_id, or an isolated profile with allow_launch=true; do not combine them.')
        }
      }
    }
    for (const key of ['element_token', 'snapshot_id', 'target_id', 'tab_id', 'scope_ref', 'continuation']) {
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

    return { ...managedParameters, session }
  }

  private async getActionCapabilities(
    driver: ComputerUseDriver
  ): Promise<
    Pick<
      ManagedComputerUseRuntime,
      'sessionAwareActions' | 'foregroundCapableActions'
    >
  > {
    const catalog = asRecord(JSON.parse(await driver.listToolsJson()))
    const tools = Array.isArray(catalog?.['tools']) ? catalog['tools'] : []
    const sessionAwareActions = new Set<string>()
    const foregroundCapableActions = new Set<string>()

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
    }

    return { sessionAwareActions, foregroundCapableActions }
  }
}
