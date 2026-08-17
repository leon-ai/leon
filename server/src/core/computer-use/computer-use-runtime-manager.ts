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
import { asRecord } from './utils'

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
    const interactionMode = this.interactionModeResolver(input)
    if (
      interactionMode === ComputerUseInteractionMode.Visible &&
      runtime.foregroundCapableActions.has(action) &&
      managedParameters['delivery_mode'] === undefined
    ) {
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
    const sessionResult = await runtime.driver.callTool(
      'start_session',
      JSON.stringify({ session })
    )
    if (sessionResult.isError) {
      throw new Error(
        sessionResult.text ||
          sessionResult.errorCode ||
          'Unable to start the computer-use session.'
      )
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
