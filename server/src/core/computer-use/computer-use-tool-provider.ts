import type {
  ToolProvider,
  ToolProviderExecutionInput,
  ToolProviderExecutionResult
} from '@/core/tool-provider/types'

import { ComputerUseArtifactStore } from './computer-use-artifact-store'
import { ComputerUseApplicationLauncher } from './computer-use-application-launcher'
import {
  COMPUTER_USE_ACTIONS,
  COMPUTER_USE_ACTION_SEQUENCE_LIMIT,
  COMPUTER_USE_ACTION_SEQUENCE_NAME,
  COMPUTER_USE_ACTION_SEQUENCE_PIXEL_CLICK_LIMIT,
  COMPUTER_USE_APP_QUERY_PARAMETER,
  COMPUTER_USE_BROWSER_QUERY_RETRY_DELAYS_MS,
  COMPUTER_USE_CAPTURE_ACTIONS,
  COMPUTER_USE_CAPTURE_AFTER_PARAMETER,
  COMPUTER_USE_COORDINATE_FIELDS,
  COMPUTER_USE_PROVIDER_ID,
  COMPUTER_USE_MODEL_OUTPUT_MAX_CHARS,
  COMPUTER_USE_SEQUENCE_ACTIONS,
  COMPUTER_USE_VISUAL_STATE_LIMIT,
  COMPUTER_USE_WINDOW_MAX_ELEMENTS,
  COMPUTER_USE_WINDOW_MAX_DEPTH,
  CUA_SESSION_ENDED_ERROR_CODE
} from './constants'
import { mapComputerUseCoordinateToSource } from './computer-use-coordinate-mapper'
import { ComputerUseResultCompactor } from './computer-use-result-compactor'
import { ComputerUseRuntimeManager } from './computer-use-runtime-manager'
import { getComputerUseSetOfMarkKey } from './computer-use-set-of-mark'
import {
  resolveComputerUseActivityOverlay,
  resolveComputerUseInteractionMode,
  resolveComputerUseSetOfMarkMode,
  resolvePreferredApplications
} from './computer-use-settings'
import { createCuaDriverAdapter } from './cua/cua-driver-adapter'
import type {
  CapturedComputerUseState,
  ComputerUseDriver,
  ComputerUseDriverFactory,
  ComputerUseImageTransform,
  ComputerUseActivityOverlayResolver,
  ComputerUseInteractionModeResolver,
  ComputerUseSetOfMarkAnnotation,
  ComputerUseSetOfMarkModeResolver,
  CuaToolResult,
  ManagedComputerUseRuntime,
  PreferredApplicationsResolver
} from './types'
import { asRecord, parseJsonRecord, hasCuaError } from './utils'

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
  private readonly artifactStore = new ComputerUseArtifactStore()
  private readonly applicationLauncher = new ComputerUseApplicationLauncher()
  private readonly resultCompactor: ComputerUseResultCompactor
  private readonly runtimeManager: ComputerUseRuntimeManager
  private readonly setOfMarkModeResolver: ComputerUseSetOfMarkModeResolver
  private executionTail: Promise<void> = Promise.resolve()

  public constructor(
    driverFactory: ComputerUseDriverFactory = createCuaDriverAdapter,
    interactionModeResolver: ComputerUseInteractionModeResolver =
      resolveComputerUseInteractionMode,
    preferredApplicationsResolver: PreferredApplicationsResolver =
      resolvePreferredApplications,
    activityOverlayResolver: ComputerUseActivityOverlayResolver =
      resolveComputerUseActivityOverlay,
    setOfMarkModeResolver: ComputerUseSetOfMarkModeResolver =
      resolveComputerUseSetOfMarkMode
  ) {
    this.setOfMarkModeResolver = setOfMarkModeResolver
    this.resultCompactor = new ComputerUseResultCompactor(
      preferredApplicationsResolver
    )
    this.runtimeManager = new ComputerUseRuntimeManager(
      driverFactory,
      interactionModeResolver,
      activityOverlayResolver,
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
    await this.runtimeManager.dispose()
  }

  private async executeAction(
    input: ToolProviderExecutionInput,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<ToolProviderExecutionResult> {
    if (action === COMPUTER_USE_ACTION_SEQUENCE_NAME) {
      return this.executeActionSequence(input, parameters)
    }

    input.onProgress?.({
      source: 'log',
      message: `Running computer-use action ${action}.`
    })

    try {
      const runtime = await this.runtimeManager.get(input.profileName)
      const recording = runtime.recordingSessionId !== undefined &&
        runtime.recordingSessionId === input.conversationSessionId
      const captureAfter =
        (parameters[COMPUTER_USE_CAPTURE_AFTER_PARAMETER] ?? recording) === true &&
        COMPUTER_USE_CAPTURE_ACTIONS.has(action) &&
        runtime.driver.supportsPostActionCapture !== false
      const driverParameters = { ...parameters }
      delete driverParameters[COMPUTER_USE_CAPTURE_AFTER_PARAMETER]
      // Tutorial queries need both handles and capture-bound annotation geometry.
      if (recording && action === 'get_window_state' &&
          driverParameters['include_screenshot'] === undefined) {
        driverParameters['include_screenshot'] = true
      }
      if (action === 'list_apps') {
        // Querying is a Leon-side compaction hint, not a Cua Driver parameter.
        delete driverParameters[COMPUTER_USE_APP_QUERY_PARAMETER]
      }
      const coordinateSafeParameters = this.applyObservationDefaults(
        input,
        action,
        this.mapCoordinatesToSource(
          input,
          action,
          driverParameters
        )
      )
      const actionParameters = await this.runtimeManager.prepareParameters(
        runtime,
        input,
        action,
        coordinateSafeParameters
      )
      const launchWindowBaseline =
        action === 'launch_app'
          ? await this.applicationLauncher.captureWindowBaseline(runtime.driver)
          : null
      const result = await this.callAction(
        runtime.driver,
        input,
        action,
        actionParameters
      )
      let structuredResult =
        parseJsonRecord(result.structuredJson) || parseJsonRecord(result.rawJson)
      const launchResolution =
        action === 'launch_app' && structuredResult && launchWindowBaseline
          ? await this.applicationLauncher.resolve(
              runtime.driver,
              input,
              actionParameters,
              structuredResult,
              launchWindowBaseline
            )
          : null
      if (launchResolution) {
        structuredResult = launchResolution.result
      }
      const compactedResult = structuredResult
        ? this.resultCompactor.compact(input, action, structuredResult)
        : null
      const persistedImages = await this.artifactStore.persistImages(
        input,
        action,
        structuredResult,
        result,
        this.setOfMarkModeResolver(input)
      )
      this.rememberVisualTransform(
        input,
        action,
        actionParameters,
        persistedImages.transform
      )
      const primaryResult = this.describeModelCoordinateSpace(
        compactedResult?.result || {
          text: this.artifactStore.buildTextPreview(result.text)
        },
        persistedImages.transform,
        persistedImages.setOfMark
      )
      const capturedState = captureAfter &&
        !hasCuaError(result) &&
        !this.resultCompactor.getStructuredFailure(structuredResult)
        ? await this.captureStateAfterAction(runtime, input, actionParameters, action)
        : null
      await this.artifactStore.persistCaptureMetadata(persistedImages, primaryResult)
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
        (launchResolution && !launchResolution.ready
          ? 'The application process started, but no usable window became available.'
          : structuredFailure?.message) ||
        result.text ||
        result.errorCode ||
        'Computer-use action failed.'
      const succeeded =
        !hasCuaError(result) &&
        structuredFailure === null &&
        launchResolution?.ready !== false
      if (succeeded && action === 'start_recording') {
        runtime.recordingSessionId = input.conversationSessionId
      } else if (succeeded && action === 'stop_recording') {
        delete runtime.recordingSessionId
      }
      const successMessage = this.getSuccessMessage(primaryResult)
      const target = asRecord(actionParameters['target'])
      // An unverified dispatch is not a failed click. Let the agent compare
      // the observed result before choosing a different input route.
      const windowClickNeedsObservation = action === 'click' &&
        (actionParameters['window_id'] != null || target?.['kind'] === 'window') &&
        ['unverifiable', 'suspected_noop'].includes(String(primaryResult['effect']))

      return {
        success: succeeded,
        message: succeeded
          ? successMessage
          : failureMessage,
        output: this.boundWindowObservation({
          action,
          ...(!succeeded ? { success: false } : {}),
          result: primaryResult,
          ...(windowClickNeedsObservation ? {
            recovery: 'Inspect the post-action state or observe the target before retrying; unverifiable does not mean failure. If the intended change is absent, do not repeat the window click. When foreground interaction is permitted, bring the target to the front, take a fresh get_desktop_state screenshot, and click the visibly exposed control with target={kind:"desktop",display_id:"primary"}. Use only that desktop image\'s coordinates, omit window identifiers and element tokens, then verify the change. If the target is obscured or focus changes, observe again before acting.'
          } : asRecord(primaryResult['escalation']) ? {
            recovery: 'Check whether the intended result is already present before retrying. If absent, follow escalation.recommended using a grounded target; do not repeat the same ineffective route. Foreground input requires an available desktop, and browser setup still requires authorization.'
          } : {}),
          ...(capturedState ? {
            post_action_state: capturedState.result,
            next_step: 'Inspect the attached post-action screenshot before another observation or retry. If navigation opened a new app or dialog, inspect that destination rather than bringing the previous window forward. Reuse this screenshot for the next action and tutorial evidence; observe again only when needed information is missing or the interface has changed.'
          } : {}),
          ...(result.text && !compactedResult?.changed
            ? { summary: this.artifactStore.buildTextPreview(succeeded ? result.text : failureMessage) }
            : {}),
          ...(result.action ? { action_result: result.action } : {}),
          ...(result.verification
            ? { verification: result.verification }
            : {}),
          ...(artifacts.length > 0 ? { artifacts } : {}),
          ...(!succeeded && (result.errorCode ||
          structuredFailure?.code ||
          launchResolution?.errorCode)
            ? {
                error_code:
                  structuredFailure?.code ||
                  launchResolution?.errorCode ||
                  result.errorCode
              }
            : {}),
          degraded: result.degraded
        }),
        ...(modelFiles.length > 0 ? { modelFiles } : {})
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.failure(message)
    }
  }

  private async executeActionSequence(
    input: ToolProviderExecutionInput,
    parameters: Record<string, unknown>
  ): Promise<ToolProviderExecutionResult> {
    const steps = parameters['steps']
    if (
      !Array.isArray(steps) ||
      steps.length === 0 ||
      steps.length > COMPUTER_USE_ACTION_SEQUENCE_LIMIT
    ) {
      return this.failure(
        `perform_actions requires between 1 and ${COMPUTER_USE_ACTION_SEQUENCE_LIMIT} steps.`
      )
    }

    const runtime = await this.runtimeManager.get(input.profileName)
    const recording = runtime.recordingSessionId !== undefined &&
      runtime.recordingSessionId === input.conversationSessionId
    const captureAfter = (parameters[COMPUTER_USE_CAPTURE_AFTER_PARAMETER] ?? recording) === true
    const pixelClickCount = steps.filter((value) => {
      const step = asRecord(value)
      const stepParameters = asRecord(step?.['parameters'])
      return (
        step?.['action'] === 'click' &&
        typeof stepParameters?.['x'] === 'number' &&
        typeof stepParameters?.['y'] === 'number' &&
        stepParameters?.['element_token'] === undefined &&
        stepParameters?.['element_index'] === undefined
      )
    }).length
    if (pixelClickCount > COMPUTER_USE_ACTION_SEQUENCE_PIXEL_CLICK_LIMIT) {
      return this.failure(
        'perform_actions accepts at most one pixel-targeted click. Observe between spatial targets or use semantic element handles.'
      )
    }

    const stepResults: Array<Record<string, unknown>> = []
    const artifacts: Array<Record<string, unknown>> = []
    let modelFiles: ToolProviderExecutionResult['modelFiles'] = []

    for (const [index, value] of steps.entries()) {
      const step = asRecord(value)
      const stepAction = step?.['action']
      const stepParameters = asRecord(step?.['parameters']) || {}
      if (
        typeof stepAction !== 'string' ||
        !COMPUTER_USE_SEQUENCE_ACTIONS.has(stepAction)
      ) {
        return this.failure(
          `Step ${index + 1} must use a supported mechanical action.`
        )
      }

      const boundedParameters = { ...stepParameters }
      delete boundedParameters[COMPUTER_USE_CAPTURE_AFTER_PARAMETER]
      // A capture mints new element handles. Preserve the already-grounded
      // handles of a mechanical sequence until its final action.
      if (index < steps.length - 1) {
        boundedParameters[COMPUTER_USE_CAPTURE_AFTER_PARAMETER] = false
      }
      if (
        index === steps.length - 1 &&
        COMPUTER_USE_CAPTURE_ACTIONS.has(stepAction)
      ) {
        boundedParameters[COMPUTER_USE_CAPTURE_AFTER_PARAMETER] = captureAfter
      }

      input.onProgress?.({
        source: 'log',
        message: `Running computer-use sequence step ${index + 1} of ${steps.length}.`
      })
      const result = await this.executeAction(
        input,
        stepAction,
        boundedParameters
      )
      const resultArtifacts = result.output['artifacts']
      if (Array.isArray(resultArtifacts)) {
        artifacts.push(
          ...resultArtifacts.filter(
            (artifact): artifact is Record<string, unknown> =>
              asRecord(artifact) !== null
          )
        )
      }
      if (result.modelFiles?.length) {
        modelFiles = result.modelFiles
      }
      stepResults.push({
        action: stepAction,
        success: result.success,
        result: result.output['result'] ?? null
      })

      if (!result.success) {
        return {
          success: false,
          message: `Computer-use sequence stopped at step ${index + 1}: ${result.message}`,
          output: {
            success: false,
            completed_action_count: index,
            steps: stepResults,
            ...(artifacts.length > 0 ? { artifacts } : {})
          },
          ...(modelFiles.length > 0 ? { modelFiles } : {})
        }
      }
    }

    return {
      success: true,
      message: `Completed ${steps.length} computer-use actions.`,
      output: {
        completed_action_count: steps.length,
        steps: stepResults,
        ...(artifacts.length > 0 ? { artifacts } : {})
      },
      ...(modelFiles.length > 0 ? { modelFiles } : {})
    }
  }

  private applyObservationDefaults(
    input: ToolProviderExecutionInput,
    action: string,
    parameters: Record<string, unknown>
  ): Record<string, unknown> {
    if (action !== 'get_window_state') return parameters

    // Bound the driver walk itself, not just the text sent to the model.
    // Callers can request deeper observations when a needed control is omitted.
    parameters = {
      max_elements: COMPUTER_USE_WINDOW_MAX_ELEMENTS,
      max_depth: COMPUTER_USE_WINDOW_MAX_DEPTH,
      ...parameters
    }
    if (
      parameters['include_screenshot'] !== undefined ||
      typeof parameters['query'] !== 'string' ||
      parameters['query'].trim().length === 0 ||
      !this.visualTransforms.has(this.getVisualTransformKey(input, parameters))
    ) {
      return parameters
    }

    // A filtered accessibility refresh can reuse the latest image coordinate
    // space. This avoids attaching another screenshot just to mint fresh
    // semantic element handles.
    return { ...parameters, include_screenshot: false }
  }

  private async callAction(
    driver: ComputerUseDriver,
    input: ToolProviderExecutionInput,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<CuaToolResult> {
    const serializedParameters = JSON.stringify(parameters)
    let result = await driver.callTool(action, serializedParameters)

    if (this.shouldRestoreSession(parameters, result)) {
      input.onProgress?.({
        source: 'log',
        message: 'Restoring the computer-use session.'
      })
      const session = parameters['session'] as string
      const sessionResult = await driver.callTool(
        'start_session',
        JSON.stringify({ session })
      )
      if (hasCuaError(sessionResult)) {
        return sessionResult
      }
      await this.runtimeManager.restoreActivityOverlay(driver, input, session)
      result = await driver.callTool(action, serializedParameters)
    }

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

  private shouldRestoreSession(
    parameters: Record<string, unknown>,
    result: CuaToolResult
  ): boolean {
    if (typeof parameters['session'] !== 'string') {
      return false
    }

    const structuredResult =
      parseJsonRecord(result.structuredJson) || parseJsonRecord(result.rawJson)
    const refusal = asRecord(structuredResult?.['refusal'])
    return (
      result.errorCode === CUA_SESSION_ENDED_ERROR_CODE ||
      refusal?.['code'] === CUA_SESSION_ENDED_ERROR_CODE ||
      structuredResult?.['code'] === CUA_SESSION_ENDED_ERROR_CODE
    )
  }

  private shouldRetryBrowserQuery(
    action: string,
    parameters: Record<string, unknown>,
    result: CuaToolResult
  ): boolean {
    if (
      action !== 'get_browser_state' ||
      hasCuaError(result) ||
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
      if (fields.some((field) => typeof parameters[field] === 'number')) {
        throw new Error('Observe this target with a fresh screenshot before using pixel coordinates; otherwise use its current element token.')
      }
      return parameters
    }

    const mappedParameters = { ...parameters }
    for (const field of fields) {
      const value = mappedParameters[field]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue
      }

      const axis = field.endsWith('x') ? 'x' : 'y'
      const size = transform.model[axis === 'x' ? 'width' : 'height']
      // Clamping a point outside the observed image can click a different
      // control. Menu-bar actions, for example, need a desktop observation.
      if (value < 0 || value >= size) {
        throw new Error(`Coordinate ${field}=${value} is outside this screenshot (0..${size - 1}). Observe the intended target; use a desktop screenshot and desktop target for controls outside the window.`)
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
    if (action !== 'get_window_state' && action !== 'get_desktop_state') return
    if (!transform) {
      // A new tree without an image cannot validate an older image's geometry.
      this.visualTransforms.delete(this.getVisualTransformKey(input, parameters))
      return
    }

    this.rememberVisualState(
      this.visualTransforms,
      this.getVisualTransformKey(input, parameters),
      transform
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
    const pid = parameters['pid'] ?? target?.['pid']
    if (typeof parameters['target_id'] === 'string') {
      return `${sessionKey}:browser:${parameters['target_id']}:${parameters['tab_id'] ?? ''}`
    }
    return typeof windowId === 'number'
      ? `${sessionKey}:window:${pid}:${windowId}`
      : `${sessionKey}:desktop`
  }

  private boundWindowObservation(output: Record<string, unknown>): Record<string, unknown> {
    const field = asRecord(output['post_action_state'])?.['elements']
      ? 'post_action_state' : 'result'
    const result = asRecord(output[field])
    if (!result || !Array.isArray(result['elements'])) return output
    const elements = result['elements']
    const bounded = {
      ...result,
      elements: [] as unknown[],
      returned_element_count: 0,
      omitted_element_count: elements.length,
      elements_complete: false,
      hint: 'Use pid and window_id with current element tokens. Observe again after acting; old tokens expire. Increase max_elements/max_depth if a needed control is omitted; query filters results, not traversal cost. If a window click has no effect, bring the target forward when permitted, then use a fresh desktop screenshot and desktop target for the visible control. Never reuse window coordinates on the desktop.'
    }
    // Include paths, metadata and envelope in the budget, not just AX elements.
    // Reserve the worst-case counter width so counters cannot overflow it.
    const budgetBase = { ...bounded, returned_element_count: elements.length }
    let remaining = COMPUTER_USE_MODEL_OUTPUT_MAX_CHARS -
      JSON.stringify({ ...output, [field]: budgetBase }).length
    for (const element of elements) {
      const cost = JSON.stringify(element).length + 1
      if (cost > remaining) continue
      bounded.elements.push(element)
      remaining -= cost
    }
    const omitted = elements.length - bounded.elements.length
    bounded.returned_element_count = bounded.elements.length
    bounded.omitted_element_count = omitted + Number(result['omitted_element_count'] || 0)
    bounded.elements_complete = omitted === 0 && result['elements_complete'] !== false
    return { ...output, [field]: bounded }
  }

  private describeModelCoordinateSpace(
    result: Record<string, unknown>,
    transform: ComputerUseImageTransform | null,
    setOfMark: ComputerUseSetOfMarkAnnotation[] = []
  ): Record<string, unknown> {
    const bounds = asRecord(result['window_bounds'])
    const marks = new Map(setOfMark.map(({ key, mark }) => [key, mark]))
    const elements = Array.isArray(result['elements'])
      ? result['elements'].map((value: unknown) => {
          const element = asRecord(value)
          if (!element) return value
          const { screen_frame: screenFrame, ...compact } = element
          const key = getComputerUseSetOfMarkKey(element)
          const mark = key ? marks.get(key) : undefined
          if (mark !== undefined) {
            compact['som_mark'] = mark
          }
          const frame = asRecord(screenFrame)
          if (!transform || !bounds || !frame) return compact
          const x = Number(frame['x']) + Number(frame['w']) / 2 - Number(bounds['x'])
          const y = Number(frame['y']) + Number(frame['h']) / 2 - Number(bounds['y'])
          const width = Number(bounds['width'])
          const height = Number(bounds['height'])
          if (
            ![x, y, width, height].every(Number.isFinite) ||
            Number(frame['w']) <= 1 || Number(frame['h']) <= 1 ||
            width <= 0 || height <= 0 ||
            x < 0 || y < 0 || x >= width || y >= height
          ) return compact
          return {
            ...compact,
            pixel_center: {
              x: Math.round(x / width * (transform.model.width - 1)),
              y: Math.round(y / height * (transform.model.height - 1))
            },
            pixel_bounds: {
              x: Math.round(Math.max(0, x - Number(frame['w']) / 2) / width * (transform.model.width - 1)),
              y: Math.round(Math.max(0, y - Number(frame['h']) / 2) / height * (transform.model.height - 1)),
              width: Math.round((Math.min(width, x + Number(frame['w']) / 2) - Math.max(0, x - Number(frame['w']) / 2)) / width * (transform.model.width - 1)),
              height: Math.round((Math.min(height, y + Number(frame['h']) / 2) - Math.max(0, y - Number(frame['h']) / 2)) / height * (transform.model.height - 1))
            }
          }
        })
      : undefined

    const observation = {
      ...result,
      ...(elements ? {
        elements,
        hint: [
          result['hint'],
          setOfMark.length > 0
            ? 'Numbered labels in the attached image match elements[].som_mark.'
            : '',
          'pixel_center is in the latest attached screenshot\'s coordinates; use its x,y for a pixel action if AX activation has no effect. Do not use raw log frames as click coordinates.'
        ].filter(Boolean).join(' ')
      } : {})
    }
    if (!transform) return observation

    return {
      ...observation,
      screenshot_width: transform.model.width,
      screenshot_height: transform.model.height,
      source_screenshot_width: transform.source.width,
      source_screenshot_height: transform.source.height,
      coordinate_space: 'attached_model_image',
      coordinate_hint: `Use actual image pixels: x=0..${transform.model.width - 1}, y=0..${transform.model.height - 1}, not a normalized 0–1000 grid. Use pixel_center verbatim when available. To convert a normalized estimate, multiply x by ${(transform.model.width - 1) / 1000} and y by ${(transform.model.height - 1) / 1000}.`
    }
  }

  private async captureStateAfterAction(
    runtime: ManagedComputerUseRuntime,
    input: ToolProviderExecutionInput,
    actionParameters: Record<string, unknown>,
    action: string
  ): Promise<CapturedComputerUseState | null> {
    const target = asRecord(actionParameters['target'])
    const isDesktop =
      action === 'invoke_menu' ||
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
      : {
          pid,
          window_id: windowId,
          max_elements: COMPUTER_USE_WINDOW_MAX_ELEMENTS,
          max_depth: COMPUTER_USE_WINDOW_MAX_DEPTH
        }
    if (
      typeof session === 'string' &&
      runtime.sessionAwareActions.has(captureAction)
    ) {
      captureParameters['session'] = session
    }

    const captureResult = await this.callAction(
      runtime.driver,
      input,
      captureAction,
      captureParameters
    )
    if (hasCuaError(captureResult)) {
      return null
    }

    const structuredResult =
      parseJsonRecord(captureResult.structuredJson) ||
      parseJsonRecord(captureResult.rawJson)
    if (this.resultCompactor.getStructuredFailure(structuredResult)) {
      return null
    }
    const compactedResult = structuredResult
        ? this.resultCompactor.compact(input, captureAction, structuredResult)
        : null
    const persistedImages = await this.artifactStore.persistImages(
      input,
      captureAction,
      structuredResult,
      captureResult,
      this.setOfMarkModeResolver(input)
    )
    this.rememberVisualTransform(
      input,
      captureAction,
      captureParameters,
      persistedImages.transform
    )
    const observation = this.describeModelCoordinateSpace(
      compactedResult?.result || {
        text: this.artifactStore.buildTextPreview(captureResult.text)
      },
      persistedImages.transform,
      persistedImages.setOfMark
    )
    if (isDesktop) {
      // Native menus are composited outside a window capture on macOS.
      // Label the new coordinate space so it cannot be used as window pixels.
      observation['capture_target'] = { kind: 'desktop' }
      observation['hint'] = 'This is a desktop observation. Use a desktop target for its pixels; window-local coordinates and old element tokens do not apply. A highlighted menu item alone does not prove the command ran.'
    }
    // Post-action captures are tutorial evidence too; bind annotation geometry
    // to their own screenshot rather than the pre-action snapshot.
    await this.artifactStore.persistCaptureMetadata(persistedImages, observation)
    return {
      result: observation,
      artifacts: persistedImages.artifacts,
      modelFiles: persistedImages.modelFiles
    }
  }

  private getSuccessMessage(result: Record<string, unknown>): string {
    if (result?.['effect'] === 'unverifiable' || result?.['effect'] === 'suspected_noop') {
      return 'Input was delivered, but its intended effect is unverified. Observe the target before deciding whether to retry.'
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
