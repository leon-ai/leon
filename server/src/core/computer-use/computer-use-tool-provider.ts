import type {
  ToolProvider,
  ToolProviderExecutionInput,
  ToolProviderExecutionResult
} from '@/core/tool-provider/types'

import { ComputerUseArtifactStore } from './computer-use-artifact-store'
import {
  COMPUTER_USE_ACTIONS,
  COMPUTER_USE_APP_QUERY_PARAMETER,
  COMPUTER_USE_BROWSER_QUERY_RETRY_DELAYS_MS,
  COMPUTER_USE_CAPTURE_ACTIONS,
  COMPUTER_USE_CAPTURE_AFTER_PARAMETER,
  COMPUTER_USE_COORDINATE_FIELDS,
  COMPUTER_USE_PROVIDER_ID,
  COMPUTER_USE_VISUAL_STATE_LIMIT
} from './constants'
import { mapComputerUseCoordinateToSource } from './computer-use-coordinate-mapper'
import { ComputerUseResultCompactor } from './computer-use-result-compactor'
import { ComputerUseRuntimeManager } from './computer-use-runtime-manager'
import {
  resolveComputerUseInteractionMode,
  resolvePreferredApplications
} from './computer-use-settings'
import { createCuaDriverAdapter } from './cua/cua-driver-adapter'
import type {
  CapturedComputerUseState,
  ComputerUseDriver,
  ComputerUseDriverFactory,
  ComputerUseImageTransform,
  ComputerUseInteractionModeResolver,
  ComputerUseVisualChange,
  CuaToolResult,
  ManagedComputerUseRuntime,
  PreferredApplicationsResolver
} from './types'
import { ComputerUseVisualChangeStatus } from './types'
import { asRecord, parseJsonRecord } from './utils'

export { COMPUTER_USE_ACTION_NAMES } from './constants'
export {
  calculateComputerUseModelImageDimensions,
  mapComputerUsePointToSource,
  shouldUseCuaSafeX11Input
} from './computer-use-coordinate-mapper'
export type {
  ComputerUseImageDimensions,
  ComputerUseImageTransform
} from './types'

/** Executes Cua actions in persistent profile runtimes and retains visual artifacts. */
export class ComputerUseToolProvider implements ToolProvider {
  public readonly id = COMPUTER_USE_PROVIDER_ID

  private readonly visualTransforms = new Map<string, ComputerUseImageTransform>()
  private readonly visualFingerprints = new Map<string, string>()
  private readonly artifactStore = new ComputerUseArtifactStore()
  private readonly resultCompactor: ComputerUseResultCompactor
  private readonly runtimeManager: ComputerUseRuntimeManager
  private executionTail: Promise<void> = Promise.resolve()

  public constructor(
    driverFactory: ComputerUseDriverFactory = createCuaDriverAdapter,
    interactionModeResolver: ComputerUseInteractionModeResolver =
      resolveComputerUseInteractionMode,
    preferredApplicationsResolver: PreferredApplicationsResolver =
      resolvePreferredApplications
  ) {
    this.resultCompactor = new ComputerUseResultCompactor(
      preferredApplicationsResolver
    )
    this.runtimeManager = new ComputerUseRuntimeManager(
      driverFactory,
      interactionModeResolver,
      this.artifactStore
    )
  }

  public async execute(
    input: ToolProviderExecutionInput
  ): Promise<ToolProviderExecutionResult> {
    const action = input.functionName
    if (!COMPUTER_USE_ACTIONS.has(action)) {
      return this.failure('The requested computer-use action is not supported.')
    }

    // Desktop actions share one cursor and focus, so profile-scoped driver
    // state must still execute serially on a shared physical computer.
    const execution = this.executionTail.then(() =>
      this.executeAction(input, action, input.parameters)
    )
    this.executionTail = execution.then(
      () => undefined,
      () => undefined
    )
    return execution
  }

  public async dispose(): Promise<void> {
    await this.executionTail
    this.visualTransforms.clear()
    this.visualFingerprints.clear()
    await this.runtimeManager.dispose()
  }

  private async executeAction(
    input: ToolProviderExecutionInput,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<ToolProviderExecutionResult> {
    input.onProgress?.({
      source: 'log',
      message: `Running computer-use action ${action}.`
    })

    try {
      const runtime = await this.runtimeManager.get(input.profileName)
      const captureAfter =
        parameters[COMPUTER_USE_CAPTURE_AFTER_PARAMETER] === true &&
        COMPUTER_USE_CAPTURE_ACTIONS.has(action) &&
        runtime.driver.supportsPostActionCapture !== false
      const driverParameters = { ...parameters }
      delete driverParameters[COMPUTER_USE_CAPTURE_AFTER_PARAMETER]
      if (action === 'list_apps') {
        // Querying is a Leon-side compaction hint, not a Cua Driver parameter.
        delete driverParameters[COMPUTER_USE_APP_QUERY_PARAMETER]
      }
      const coordinateSafeParameters = this.mapCoordinatesToSource(
        input,
        action,
        driverParameters
      )
      const actionParameters = await this.runtimeManager.prepareParameters(
        runtime,
        input,
        action,
        coordinateSafeParameters
      )
      const result = await this.callAction(
        runtime.driver,
        input,
        action,
        actionParameters
      )
      const structuredResult =
        parseJsonRecord(result.structuredJson) || parseJsonRecord(result.rawJson)
      const compactedResult = structuredResult
        ? this.resultCompactor.compact(input, action, structuredResult)
        : null
      const persistedImages = await this.artifactStore.persistImages(
        input,
        action,
        structuredResult,
        result
      )
      this.rememberVisualTransform(
        input,
        action,
        actionParameters,
        persistedImages.transform
      )
      this.rememberVisualFingerprint(
        input,
        action,
        actionParameters,
        persistedImages.fingerprint
      )
      let primaryResult = this.describeModelCoordinateSpace(
        compactedResult?.result || {
          text: this.artifactStore.buildTextPreview(result.text)
        },
        persistedImages.transform
      )
      const capturedState = captureAfter
        ? await this.captureStateAfterAction(runtime, input, actionParameters)
        : null
      if (
        capturedState?.visualChange.status ===
        ComputerUseVisualChangeStatus.Unchanged
      ) {
        primaryResult = this.markSuspectedNoop(primaryResult)
      }
      const structuredArtifact =
        structuredResult && compactedResult?.changed
          ? await this.artifactStore.persistStructuredResult(
              input,
              action,
              structuredResult
            )
          : null
      const artifacts = structuredArtifact
        ? [
            ...persistedImages.artifacts,
            structuredArtifact,
            ...(capturedState?.artifacts || [])
          ]
        : [
            ...persistedImages.artifacts,
            ...(capturedState?.artifacts || [])
          ]
      const modelFiles = capturedState?.modelFiles.length
        ? capturedState.modelFiles
        : persistedImages.modelFiles

      const structuredFailure =
        this.resultCompactor.getStructuredFailure(structuredResult)
      const failureMessage =
        result.text ||
        result.errorCode ||
        structuredFailure?.message ||
        'Computer-use action failed.'
      const succeeded =
        !result.isError && !result.errorCode && structuredFailure === null
      const successMessage = this.getSuccessMessage(capturedState?.visualChange)

      return {
        success: succeeded,
        message: succeeded
          ? successMessage
          : failureMessage,
        output: {
          action,
          ...(!succeeded ? { success: false } : {}),
          result: primaryResult,
          ...(capturedState ? { post_action_state: capturedState.result } : {}),
          ...(capturedState
            ? { visual_change: capturedState.visualChange }
            : {}),
          ...(result.text && !compactedResult?.changed
            ? { summary: this.artifactStore.buildTextPreview(result.text) }
            : {}),
          ...(result.action ? { action_result: result.action } : {}),
          ...(result.verification
            ? { verification: result.verification }
            : {}),
          ...(artifacts.length > 0 ? { artifacts } : {}),
          ...(result.errorCode || structuredFailure?.code
            ? { error_code: result.errorCode || structuredFailure?.code }
            : {}),
          degraded: result.degraded
        },
        ...(modelFiles.length > 0 ? { modelFiles } : {})
      }
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private async callAction(
    driver: ComputerUseDriver,
    input: ToolProviderExecutionInput,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<CuaToolResult> {
    const serializedParameters = JSON.stringify(parameters)
    let result = await driver.callTool(action, serializedParameters)

    if (!this.shouldRetryBrowserQuery(action, parameters, result)) {
      return result
    }

    input.onProgress?.({
      source: 'log',
      message: 'Waiting briefly for the browser page to become observable.'
    })

    // Dynamic pages can acknowledge navigation before their accessibility tree
    // exists. A short bounded retry avoids spending another model turn polling.
    for (const delayMs of COMPUTER_USE_BROWSER_QUERY_RETRY_DELAYS_MS) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs)
      })
      result = await driver.callTool(action, serializedParameters)
      if (!this.shouldRetryBrowserQuery(action, parameters, result)) {
        break
      }
    }

    return result
  }

  private shouldRetryBrowserQuery(
    action: string,
    parameters: Record<string, unknown>,
    result: CuaToolResult
  ): boolean {
    if (
      action !== 'get_browser_state' ||
      result.isError ||
      typeof parameters['query'] !== 'string' ||
      parameters['query'].trim().length === 0
    ) {
      return false
    }

    const structuredResult =
      parseJsonRecord(result.structuredJson) || parseJsonRecord(result.rawJson)
    const snapshot = asRecord(structuredResult?.['snapshot'])
    const refs = structuredResult?.['refs']
    const contentRefs = structuredResult?.['content_refs']

    return (
      snapshot?.['total_nodes'] === 0 &&
      Array.isArray(refs) &&
      refs.length === 0 &&
      Array.isArray(contentRefs) &&
      contentRefs.length === 0
    )
  }

  private mapCoordinatesToSource(
    input: ToolProviderExecutionInput,
    action: string,
    parameters: Record<string, unknown>
  ): Record<string, unknown> {
    const fields = COMPUTER_USE_COORDINATE_FIELDS[action]
    if (!fields) {
      return parameters
    }

    const transform = this.visualTransforms.get(
      this.getVisualTransformKey(input, parameters)
    )
    if (!transform) {
      return parameters
    }

    const mappedParameters = { ...parameters }
    for (const field of fields) {
      const value = mappedParameters[field]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue
      }

      mappedParameters[field] = mapComputerUseCoordinateToSource(
        value,
        field.includes('x') ? 'x' : 'y',
        transform
      )
    }

    return mappedParameters
  }

  private rememberVisualTransform(
    input: ToolProviderExecutionInput,
    action: string,
    parameters: Record<string, unknown>,
    transform: ComputerUseImageTransform | null
  ): void {
    if (
      !transform ||
      (action !== 'get_window_state' && action !== 'get_desktop_state')
    ) {
      return
    }

    this.rememberVisualState(
      this.visualTransforms,
      this.getVisualTransformKey(input, parameters),
      transform
    )
  }

  private rememberVisualFingerprint(
    input: ToolProviderExecutionInput,
    action: string,
    parameters: Record<string, unknown>,
    fingerprint: string | null
  ): void {
    if (
      !fingerprint ||
      (action !== 'get_window_state' && action !== 'get_desktop_state')
    ) {
      return
    }

    this.rememberVisualState(
      this.visualFingerprints,
      this.getVisualTransformKey(input, parameters),
      fingerprint
    )
  }

  private rememberVisualState<T>(
    store: Map<string, T>,
    key: string,
    value: T
  ): void {
    store.delete(key)
    store.set(key, value)

    while (store.size > COMPUTER_USE_VISUAL_STATE_LIMIT) {
      const oldestKey = store.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      store.delete(oldestKey)
    }
  }

  private getVisualTransformKey(
    input: ToolProviderExecutionInput,
    parameters: Record<string, unknown>
  ): string {
    const target = asRecord(parameters['target'])
    const sessionKey = `${input.profileName}:${input.conversationSessionId || 'unscoped'}`
    if (parameters['scope'] === 'desktop' || target?.['kind'] === 'desktop') {
      return `${sessionKey}:desktop`
    }

    const windowId = parameters['window_id'] ?? target?.['window_id']
    return typeof windowId === 'number'
      ? `${sessionKey}:window:${windowId}`
      : `${sessionKey}:desktop`
  }

  private describeModelCoordinateSpace(
    result: Record<string, unknown>,
    transform: ComputerUseImageTransform | null
  ): Record<string, unknown> {
    if (!transform) {
      return result
    }

    return {
      ...result,
      screenshot_width: transform.model.width,
      screenshot_height: transform.model.height,
      source_screenshot_width: transform.source.width,
      source_screenshot_height: transform.source.height,
      coordinate_space: 'attached_model_image'
    }
  }

  private async captureStateAfterAction(
    runtime: ManagedComputerUseRuntime,
    input: ToolProviderExecutionInput,
    actionParameters: Record<string, unknown>
  ): Promise<CapturedComputerUseState | null> {
    const target = asRecord(actionParameters['target'])
    const isDesktop =
      actionParameters['scope'] === 'desktop' || target?.['kind'] === 'desktop'
    const pid = actionParameters['pid'] ?? target?.['pid']
    const windowId = actionParameters['window_id'] ?? target?.['window_id']
    const captureAction = isDesktop ? 'get_desktop_state' : 'get_window_state'
    if (
      !isDesktop &&
      (typeof pid !== 'number' || typeof windowId !== 'number')
    ) {
      return null
    }

    input.onProgress?.({
      source: 'log',
      message: 'Capturing the resulting interface state.'
    })
    const session = actionParameters['session']
    const captureParameters: Record<string, unknown> = isDesktop
      ? {}
      : { pid, window_id: windowId }
    if (
      typeof session === 'string' &&
      runtime.sessionAwareActions.has(captureAction)
    ) {
      captureParameters['session'] = session
    }

    const observationKey = this.getVisualTransformKey(input, actionParameters)
    const previousFingerprint = this.visualFingerprints.get(observationKey)
    const captureResult = await this.callAction(
      runtime.driver,
      input,
      captureAction,
      captureParameters
    )
    if (captureResult.isError || captureResult.errorCode) {
      return null
    }

    const structuredResult =
      parseJsonRecord(captureResult.structuredJson) ||
      parseJsonRecord(captureResult.rawJson)
    const compactedResult = structuredResult
        ? this.resultCompactor.compact(input, captureAction, structuredResult)
        : null
    const persistedImages = await this.artifactStore.persistImages(
      input,
      captureAction,
      structuredResult,
      captureResult
    )
    this.rememberVisualTransform(
      input,
      captureAction,
      captureParameters,
      persistedImages.transform
    )
    this.rememberVisualFingerprint(
      input,
      captureAction,
      captureParameters,
      persistedImages.fingerprint
    )

    const visualChange: ComputerUseVisualChange = {
      status:
        previousFingerprint && persistedImages.fingerprint
          ? previousFingerprint === persistedImages.fingerprint
            ? ComputerUseVisualChangeStatus.Unchanged
            : ComputerUseVisualChangeStatus.Changed
          : ComputerUseVisualChangeStatus.Unavailable,
      comparison: 'exact_capture'
    }

    return {
      result: this.describeModelCoordinateSpace(
        compactedResult?.result || {
          text: this.artifactStore.buildTextPreview(captureResult.text)
        },
        persistedImages.transform
      ),
      artifacts: persistedImages.artifacts,
      modelFiles: persistedImages.modelFiles,
      visualChange
    }
  }

  private markSuspectedNoop(
    result: Record<string, unknown>
  ): Record<string, unknown> {
    return result['effect'] === 'confirmed'
      ? result
      : { ...result, effect: 'suspected_noop' }
  }

  private getSuccessMessage(
    visualChange?: ComputerUseVisualChange
  ): string {
    if (visualChange?.status === ComputerUseVisualChangeStatus.Unchanged) {
      return 'Computer input was delivered, but the captured interface did not change. Treat the intended effect as unverified.'
    }
    if (visualChange?.status === ComputerUseVisualChangeStatus.Changed) {
      return 'Computer input was delivered and the captured interface changed. Verify the intended result from the returned state.'
    }

    return 'Computer-use action completed.'
  }

  private failure(message: string): ToolProviderExecutionResult {
    return {
      success: false,
      message,
      output: {
        success: false,
        error: message
      }
    }
  }
}
