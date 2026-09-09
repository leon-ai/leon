import { setTimeout as delay } from 'node:timers/promises'

import type {
  ToolProvider,
  ToolProviderExecutionInput,
  ToolProviderExecutionResult
} from '@/core/tool-provider/types'
import { LogHelper } from '@/helpers/log-helper'

import { ComputerUseArtifactStore } from './computer-use-artifact-store'
import { ComputerUseApplicationLauncher } from './computer-use-application-launcher'
import {
  COMPUTER_USE_ACTIONS,
  COMPUTER_USE_OBSERVATION_SETTLE_MAX_MS,
  COMPUTER_USE_ACTION_SEQUENCE_LIMIT,
  COMPUTER_USE_ACTION_SEQUENCE_NAME,
  COMPUTER_USE_ACTION_SEQUENCE_PIXEL_CLICK_LIMIT,
  COMPUTER_USE_APP_QUERY_PARAMETER,
  COMPUTER_USE_BROWSER_QUERY_RETRY_DELAYS_MS,
  COMPUTER_USE_CAPTURE_ACTIONS,
  COMPUTER_USE_CAPTURE_AFTER_PARAMETER,
  COMPUTER_USE_CAPTURE_FAILED_ERROR_CODE,
  COMPUTER_USE_COORDINATE_FIELDS,
  COMPUTER_USE_PROVIDER_ID,
  COMPUTER_USE_MODEL_OUTPUT_MAX_CHARS,
  COMPUTER_USE_SEQUENCE_ACTIONS,
  COMPUTER_USE_SCREEN_CAPTURE_ACTIONS,
  COMPUTER_USE_VISUAL_STATE_LIMIT,
  COMPUTER_USE_WINDOW_MAX_ELEMENTS,
  COMPUTER_USE_WINDOW_MAX_DEPTH,
  CUA_SESSION_ENDED_ERROR_CODE,
  CUA_BROWSER_CONSENT_ERROR_CODE,
  CUA_WINDOW_CAPTURE_OCCLUDED_ERROR_CODE
} from './constants'
import { mapComputerUseCoordinateToSource } from './computer-use-coordinate-mapper'
import { ComputerUseResultCompactor } from './computer-use-result-compactor'
import { ComputerUseRuntimeManager } from './computer-use-runtime-manager'
import { getComputerUseSetOfMarkKey } from './computer-use-set-of-mark'
import {
  resolveComputerUseActivityOverlay,
  resolveComputerUseBrowserInspection,
  resolveComputerUseInteractionMode,
  resolveComputerUseSetOfMarkMode,
  resolvePreferredApplications
} from './computer-use-settings'
import { createCuaDriverAdapter } from './cua/cua-driver-adapter'
import { CuaDesktopSetupPendingError, CuaDesktopSetupState } from './cua/cua-desktop-setup'
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
import { asRecord, parseJsonRecord, hasCuaError, isComputerUseEffectUncertain } from './utils'

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
  private readonly visualStateIds = new Map<string, string>()
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
    const execution = this.executionTail.then(async () => {
      try {
        return await this.executeAction(input, action, input.parameters)
      } catch (error) {
        return this.executionFailure(error)
      } finally {
        // Keep the cursor through a batch, then hide it even on failure or when
        // the owner stopped the agent while native input was completing.
        await this.runtimeManager.finishExecution(input.profileName)
      }
    })
    this.executionTail = execution.then(
      () => undefined,
      () => undefined
    )
    return execution
  }

  public async dispose(): Promise<void> {
    await this.executionTail
    this.visualTransforms.clear()
    this.visualStateIds.clear()
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

    const startedAt = performance.now()
    const timings: Record<string, number> = {}
    try {
      const runtime = await this.runtimeManager.get(input)
      timings['runtime'] = Math.round(performance.now() - startedAt)
      const recording = runtime.recordingSessionId !== undefined &&
        runtime.recordingSessionId === input.conversationSessionId
      const captureAfter =
        (parameters[COMPUTER_USE_CAPTURE_AFTER_PARAMETER] ?? true) === true &&
        COMPUTER_USE_CAPTURE_ACTIONS.has(action) &&
        runtime.driver.supportsPostActionCapture !== false
      const driverParameters = { ...parameters }
      delete driverParameters[COMPUTER_USE_CAPTURE_AFTER_PARAMETER]
      const settleMs = driverParameters['settle_ms'] ?? 0
      delete driverParameters['settle_ms']
      if (!Number.isInteger(settleMs) || Number(settleMs) < 0 ||
          Number(settleMs) > COMPUTER_USE_OBSERVATION_SETTLE_MAX_MS) {
        throw new Error(`settle_ms must be an integer between 0 and ${COMPUTER_USE_OBSERVATION_SETTLE_MAX_MS}.`)
      }
      const isObservation = action === 'get_window_state' || action === 'get_desktop_state'
      if (Number(settleMs) > 0 && !isObservation && !captureAfter) {
        throw new Error('settle_ms requires an observation or an action with capture_after enabled.')
      }
      if (isObservation) {
        // The model can observe a loading destination once after a bounded wait;
        // do not infer page readiness from colors, titles or inaccessible trees.
        if (Number(settleMs) > 0) {
          await delay(Number(settleMs))
          // A delayed refresh follows a transition; a previous screenshot is
          // not suitable for the query-only image reuse optimization.
          if (action === 'get_window_state') driverParameters['include_screenshot'] ??= true
        }
      }
      const cursorTarget = asRecord(driverParameters['target'])
      if (action === 'move_cursor' && (
        cursorTarget?.['kind'] !== 'desktop' || cursorTarget['display_id'] !== 'primary'
      )) {
        throw new Error('move_cursor requires target={kind:"desktop",display_id:"primary"} from a fresh get_desktop_state capture. Cursor overlay controls are host-managed.')
      }
      if (action === 'zoom' && (
        !Number.isInteger(driverParameters['pid']) ||
        !Number.isInteger(driverParameters['window_id']) ||
        !['x1', 'x2', 'y1', 'y2'].every((key) => Number.isFinite(driverParameters[key])) ||
        Number(driverParameters['x1']) >= Number(driverParameters['x2']) ||
        Number(driverParameters['y1']) >= Number(driverParameters['y2'])
      )) {
        throw new Error('zoom requires an exact pid/window_id and a nonempty rectangle with x1 < x2 and y1 < y2 from the latest full-window screenshot.')
      }
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
          driverParameters,
          runtime
        )
      )
      const actionParameters = await this.runtimeManager.prepareParameters(
        runtime,
        input,
        action,
        coordinateSafeParameters
      )
      const previousVisualStateId = this.visualStateIds.get(
        this.getVisualTransformKey(input, actionParameters)
      )
      const launchWindowBaseline =
        action === 'launch_app'
          ? await this.applicationLauncher.captureWindowBaseline(runtime.driver)
          : null
      if (action === 'zoom') {
        // Native zoom does not accept a session label. A new crop can replace
        // its shared mapping, so another conversation must not reuse an old one.
        for (const [key, transform] of this.visualTransforms) {
          if (transform.fromZoom) this.visualTransforms.delete(key)
        }
      }
      const driverStartedAt = performance.now()
      const result = await this.callAction(
        runtime.driver,
        input,
        action,
        actionParameters
      )
      let structuredResult =
        parseJsonRecord(result.structuredJson) || parseJsonRecord(result.rawJson)
      if (hasCuaError(result) && COMPUTER_USE_SCREEN_CAPTURE_ACTIONS.has(action)) {
        this.forgetVisualState(input, actionParameters)
      }
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
      const structuredFailure = this.resultCompactor.getStructuredFailure(structuredResult)
      const actionFailed = hasCuaError(result) || structuredFailure !== null
      timings['driver'] = Math.round(performance.now() - driverStartedAt)
      const artifactsStartedAt = performance.now()
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
      this.rememberVisualStateId(
        input,
        action,
        actionParameters,
        persistedImages.visualStateId
      )
      let primaryResult = this.describeModelCoordinateSpace(
        {
          ...(compactedResult?.result || {
            text: this.artifactStore.buildTextPreview(result.text)
          }),
          ...(persistedImages.visualStateId
            ? { visual_state_id: persistedImages.visualStateId }
            : {})
        },
        persistedImages.transform,
        persistedImages.setOfMark
      )
      timings['artifacts'] = Math.round(performance.now() - artifactsStartedAt)
      const captureStartedAt = performance.now()
      // A modal may take focus between input and observation. On delivery
      // failure, observe the desktop instead of reusing the blocked window.
      const captureParameters = actionFailed
        ? { scope: 'desktop', session: actionParameters['session'] }
        : actionParameters
      // Hide the input overlay before capturing evidence, not just when the
      // tool returns; its animation otherwise makes unchanged screens differ.
      const recoverObservation = actionFailed && action === 'get_window_state' && Number(settleMs) > 0
      if (captureAfter || recoverObservation) await this.runtimeManager.finishExecution(input.profileName)
      // Wait after delivery, so an asynchronous destination can replace the
      // source window before capture. Never replay the input while waiting.
      if (captureAfter && !actionFailed && Number(settleMs) > 0) await delay(Number(settleMs))
      const capture = (targetParameters: Record<string, unknown>): Promise<CapturedComputerUseState | null> =>
        this.captureStateAfterAction(runtime, input, targetParameters, action)
          .catch((error: unknown) => this.failedCapture(
            input, action === 'invoke_menu' ? { scope: 'desktop' } : targetParameters,
            COMPUTER_USE_CAPTURE_FAILED_ERROR_CODE,
            error instanceof Error ? error.message : String(error)
          ))
      let capturedState = captureAfter || recoverObservation ? await capture(captureParameters) : null
      const capturedWindowId = captureParameters['window_id'] ?? asRecord(captureParameters['target'])?.['window_id']
      if (capturedState?.result['success'] === false && typeof capturedWindowId === 'number' && action !== 'invoke_menu') {
        // Saving or closing a dialog can remove the source window. Return its
        // destination in the same call instead of encouraging a repeated click.
        const desktopState = await capture({ scope: 'desktop', session: actionParameters['session'] })
        if (desktopState?.modelFiles.length && desktopState.result['success'] !== false) {
          const previousTargetError = { ...capturedState.result }
          // The fallback resolved the observation gap; retain diagnostics
          // without an obsolete instruction to capture again.
          delete previousTargetError['recovery']
          capturedState = {
            ...desktopState,
            result: { ...desktopState.result, previous_target_error: previousTargetError }
          }
        }
      }
      const visualStateUnchanged =
        previousVisualStateId !== undefined &&
        capturedState?.visualStateId === previousVisualStateId &&
        isComputerUseEffectUncertain(primaryResult['effect'])
      timings['post_action_capture'] = Math.round(performance.now() - captureStartedAt)
      if (visualStateUnchanged) {
        primaryResult = { ...primaryResult, effect: 'suspected_noop' }
      }
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

      const failureMessage =
        (launchResolution && !launchResolution.ready
          ? 'The application process started, but no usable window became available.'
          : structuredFailure?.message) ||
        result.text ||
        result.errorCode ||
        'Computer-use action failed.'
      const succeeded =
        !actionFailed &&
        launchResolution?.ready !== false
      const failureCode = structuredFailure?.code ||
        launchResolution?.errorCode || result.errorCode
      if (succeeded && action === 'start_recording') {
        runtime.recordingSessionId = input.conversationSessionId
      } else if (succeeded && action === 'stop_recording') {
        delete runtime.recordingSessionId
      }
      const successMessage = visualStateUnchanged
        ? 'Computer input was delivered, but the captured interface did not change. Treat the intended effect as unverified.'
        : this.getSuccessMessage(primaryResult)
      const recovery = capturedState?.result['recovery'] ||
        this.getActionRecovery(primaryResult, actionParameters, failureCode)

      return {
        success: succeeded,
        message: succeeded
          ? successMessage
          : failureMessage,
        output: this.boundWindowObservation({
          action,
          ...(!succeeded ? { success: false } : {}),
          result: primaryResult,
          ...(action === 'get_browser_state' || action === 'browser_prepare'
            ? { existing_profile_authorized: runtime.browserInspectionAllowed } : {}),
          ...(recovery ? { recovery } : {}),
          ...(capturedState ? {
            post_action_state: capturedState.result,
            next_step: capturedState.result['success'] === false
              ? 'Input may have landed, but the post-action observation failed. Follow its recovery diagnostics before another pixel action; do not replay input solely because capture failed.'
              : 'Inspect the post-action state and any attached screenshot before another observation or retry. If navigation opened a new tab, app or dialog, inspect that destination rather than bringing the previous window forward. If it is blank or loading, observe the destination again with settle_ms before declaring a blocker; do not replay the navigation. Otherwise reuse this evidence unless needed information is missing or the interface has changed.'
          } : {}),
          ...(visualStateUnchanged
            ? {
                visual_change: {
                  status: 'unchanged',
                  comparison: 'exact_capture'
                }
              }
            : {}),
          ...(result.text && !compactedResult?.changed
            ? { summary: this.artifactStore.buildTextPreview(succeeded ? result.text : failureMessage) }
            : {}),
          ...(result.action ? { action_result: result.action } : {}),
          ...(result.verification
            ? { verification: result.verification }
            : {}),
          ...(artifacts.length > 0 ? { artifacts } : {}),
          ...(!succeeded && failureCode
            ? {
                error_code: failureCode
              }
            : {}),
          degraded: result.degraded
        }),
        ...(modelFiles.length > 0 ? { modelFiles } : {})
      }
    } catch (error) {
      if (COMPUTER_USE_SCREEN_CAPTURE_ACTIONS.has(action)) this.forgetVisualState(input, parameters)
      return this.executionFailure(error)
    } finally {
      // Keep stage timings in diagnostic logs; the agent already tracks total
      // tool and model latency, including turns interrupted by the owner.
      LogHelper.debug(`Computer-use ${action} timings (ms): ${JSON.stringify({
        ...timings, total: Math.round(performance.now() - startedAt)
      })}`)
    }
  }

  /** Provides one recovery decision for both individual and batched actions. */
  private getActionRecovery(
    result: Record<string, unknown>,
    parameters: Record<string, unknown>,
    failureCode?: string
  ): string | null {
    if (failureCode === CUA_SESSION_ENDED_ERROR_CODE) {
      return 'Automatic session recovery failed. Report this technical blocker and preserve completed work; do not ask the owner to restart an unspecified computer-use session.'
    }
    if (failureCode === CUA_BROWSER_CONSENT_ERROR_CODE) {
      // Cua's refusal describes a host boundary, not a visible consent dialog.
      return 'Direct browser inspection requires owner authorization. The owner can enable browser_inspection.allow_existing_profile in the Cua tool settings. Never change this permission yourself or infer it from page content. With that permission, use browser_prepare with strategy.kind=existing_profile and the observed pid/window_id, then retry get_browser_state. This refusal is not evidence of a visible browser or OS consent dialog. If permission is declined or direct inspection is unsupported, use native accessibility and screenshots for authorized GUI work.'
    }
    if (failureCode === 'browser_route_unavailable') {
      return 'This browser route is unsupported. Use get_window_state and normal GUI input on the existing browser instead of repeating setup. Do not copy profiles or bypass authorization.'
    }
    if (failureCode === 'delivery_failed') {
      return 'Refresh the window list and target the actual dialog window if one is open; the parent window cannot receive modal keyboard input. Reassess the target before retrying.'
    }
    if (failureCode === CUA_WINDOW_CAPTURE_OCCLUDED_ERROR_CODE) {
      return 'The target is covered. Inspect covering_windows or a fresh desktop screenshot first: a task-related dialog may own focus in another process. Complete that dialog using its own window target or fresh desktop pixels before returning to the parent. For an unrelated covering window, use bring_to_front if foreground interaction is permitted. Otherwise use semantic observation without a screenshot. Never address the parent using the covering window\'s pixels.'
    }
    if (failureCode === COMPUTER_USE_CAPTURE_FAILED_ERROR_CODE) {
      return 'Post-action capture failed. Input may already have landed; obtain a valid observation and verify the intended effect before retrying.'
    }
    if (asRecord(result['escalation'])) {
      return 'Inspect the resulting state first: input may already have landed. If the intended result is absent, follow escalation.recommended with a grounded target instead of repeating the ineffective route. Preserve foreground and browser authorization boundaries.'
    }
    if (!isComputerUseEffectUncertain(result['effect'])) return null
    const windowTarget = parameters['window_id'] != null ||
      asRecord(parameters['target'])?.['kind'] === 'window'
    return 'Inspect the post-action state before retrying; unverified delivery alone does not mean failure.' +
      (windowTarget && result['effect'] === 'suspected_noop'
        ? ' If the intended change is absent and foreground interaction is permitted, expose the target, take a fresh get_desktop_state screenshot, and use a desktop target with that image\'s coordinates. Never reuse window coordinates or element tokens on the desktop. Verify the change before continuing.'
        : '')
  }

  private executionFailure(error: unknown): ToolProviderExecutionResult {
    if (error instanceof CuaDesktopSetupPendingError) {
      return {
        success: false,
        message: error.message,
        output: {
          success: false,
          error_code: 'computer_use_setup_pending',
          setup_state: CuaDesktopSetupState.ActivationPending,
          error: error.message,
          // Supply setup facts so the LLM can explain the next step naturally.
          setup: {
            component: 'GNOME WinRects extension',
            purpose: 'computer use on Wayland',
            installed: true,
            activation_requires: 'a new GNOME desktop session',
            owner_steps: ['save work', 'log out and back in', 'retry the request'],
            initial_setup: true
          },
          guidance: 'Explain the setup and required owner steps in a friendly message in your own words. Pause computer use until activation is complete.'
        }
      }
    }
    return this.failure(error instanceof Error ? error.message : String(error))
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

    const pixelClickCount = steps.filter((value) => {
      const step = asRecord(value)
      const stepParameters = asRecord(step?.['parameters'])
      return (
        (step?.['action'] === 'click' || step?.['action'] === 'type_text') &&
        typeof stepParameters?.['x'] === 'number' &&
        typeof stepParameters?.['y'] === 'number'
      )
    }).length
    if (pixelClickCount > COMPUTER_USE_ACTION_SEQUENCE_PIXEL_CLICK_LIMIT) {
      return this.failure(
        'perform_actions accepts at most one pixel-targeted click, including the focus click for type_text with x/y. Observe between spatial targets or use semantic element handles.'
      )
    }
    // Reject unsupported actions before setup or input. Their position in a
    // sequence must not cause an avoidable partial edit.
    for (const [index, value] of steps.entries()) {
      const step = asRecord(value)
      if (typeof step?.['action'] !== 'string' ||
          !COMPUTER_USE_SEQUENCE_ACTIONS.has(step['action']) ||
          !asRecord(step['parameters'])) {
        return this.failure(`Step ${index + 1} must use a supported mechanical action with parameters.`)
      }
    }

    const captureAfter = (parameters[COMPUTER_USE_CAPTURE_AFTER_PARAMETER] ?? true) === true
    const stepResults: Array<Record<string, unknown>> = []
    const artifacts: Array<Record<string, unknown>> = []
    let modelFiles: ToolProviderExecutionResult['modelFiles'] = []
    let postActionState: unknown
    let recovery: unknown
    let nextStep: unknown
    let failure: ToolProviderExecutionResult | undefined

    for (const [index, value] of steps.entries()) {
      const step = asRecord(value)!
      const stepAction = step['action'] as string
      const stepParameters = asRecord(step['parameters'])!

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
      // Preserve final visual evidence for convergence checks across batches.
      postActionState = result.output['post_action_state']
      recovery = result.output['recovery']
      nextStep = result.output['next_step']
      stepResults.push({
        action: stepAction,
        success: result.success,
        result: result.output['result'] ?? null,
        ...(recovery ? { recovery } : {}),
        ...(result.output['error_code'] ? { error_code: result.output['error_code'] } : {})
      })

      if (!result.success) {
        failure = result
        break
      }
    }

    return {
      success: !failure,
      message: failure
        ? `Computer-use sequence stopped at step ${stepResults.length}: ${failure.message}`
        : `Completed ${steps.length} computer-use actions.`,
      output: this.boundWindowObservation({
        ...(failure ? { success: false } : {}),
        completed_action_count: stepResults.length - (failure ? 1 : 0),
        ...(failure?.output['error_code'] ? { error_code: failure.output['error_code'] } : {}),
        steps: stepResults,
        ...(recovery ? { recovery } : {}),
        ...(nextStep ? { next_step: nextStep } : {}),
        ...(postActionState ? { post_action_state: postActionState } : {}),
        ...(artifacts.length > 0 ? { artifacts } : {})
      }),
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
    let result = await this.callDriverAction(driver, action, parameters)

    if (this.shouldRestoreSession(result)) {
      input.onProgress?.({
        source: 'log',
        message: 'Restoring the computer-use session.'
      })
      const session = parameters['session']
      // Catalog-only actions use Cua's implicit transport session. They can
      // expire while named-session actions continue, and cannot accept a label.
      const sessionResult = await driver.callTool(
        'start_session',
        JSON.stringify(typeof session === 'string' ? { session } : {})
      )
      if (hasCuaError(sessionResult) || this.resultCompactor.getStructuredFailure(
        parseJsonRecord(sessionResult.structuredJson) || parseJsonRecord(sessionResult.rawJson)
      )) {
        return sessionResult
      }
      if (typeof session === 'string') {
        await this.runtimeManager.restoreActivityOverlay(driver, input, session, action)
      }
      result = await this.callDriverAction(driver, action, parameters)
    }

    const failure = this.resultCompactor.getStructuredFailure(
      parseJsonRecord(result.structuredJson) || parseJsonRecord(result.rawJson)
    )
    if (action === 'get_browser_state' &&
        (result.errorCode === CUA_BROWSER_CONSENT_ERROR_CODE || failure?.code === CUA_BROWSER_CONSENT_ERROR_CODE) &&
        resolveComputerUseBrowserInspection(input) &&
        Number.isInteger(parameters['pid']) && Number(parameters['pid']) > 0 &&
        Number.isInteger(parameters['window_id']) && Number(parameters['window_id']) > 0) {
      // An existing owner grant makes setup routine. Keep it in the provider
      // instead of spending a model turn deciding to repeat Cua's next action.
      const prepared = await driver.callTool('browser_prepare', JSON.stringify({
        pid: parameters['pid'], window_id: parameters['window_id'],
        strategy: { kind: 'existing_profile' },
        ...(typeof parameters['session'] === 'string' ? { session: parameters['session'] } : {})
      }))
      if (hasCuaError(prepared) || this.resultCompactor.getStructuredFailure(
        parseJsonRecord(prepared.structuredJson) || parseJsonRecord(prepared.rawJson)
      )) return prepared
      result = await this.callDriverAction(driver, action, parameters)
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
      await delay(delayMs)
      result = await driver.callTool(action, serializedParameters)
      if (!this.shouldRetryBrowserQuery(action, parameters, result)) {
        break
      }
    }

    return result
  }

  /** Makes pixel-targeted typing honor the same focus contract on every driver. */
  private async callDriverAction(
    driver: ComputerUseDriver,
    action: string,
    parameters: Record<string, unknown>
  ): Promise<CuaToolResult> {
    const hasPixelTarget =
      typeof parameters['x'] === 'number' &&
      typeof parameters['y'] === 'number'
    if (action !== 'type_text' || !hasPixelTarget) {
      return driver.callTool(action, JSON.stringify(parameters))
    }

    // Some native routes type into the existing focus even when x/y are
    // supplied. Establish focus explicitly so type_text keeps its public API.
    const clickParameters = { ...parameters }
    delete clickParameters['text']
    const clickResult = await driver.callTool(
      'click',
      JSON.stringify(clickParameters)
    )
    const clickOutput =
      parseJsonRecord(clickResult.structuredJson) ||
      parseJsonRecord(clickResult.rawJson)
    if (
      hasCuaError(clickResult) ||
      this.resultCompactor.getStructuredFailure(clickOutput)
    ) {
      return clickResult
    }

    const typeParameters = { ...parameters }
    delete typeParameters['x']
    delete typeParameters['y']
    // Only the focus click uses Cua's crop translation; text uses that focus.
    delete typeParameters['from_zoom']
    return driver.callTool('type_text', JSON.stringify(typeParameters))
  }

  private shouldRestoreSession(
    result: CuaToolResult
  ): boolean {
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
    parameters: Record<string, unknown>,
    runtime: ManagedComputerUseRuntime
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
    // Crop padding belongs to the native driver, not to Leon's image scaler.
    // Never let model-supplied flags reinterpret a full-window observation.
    delete mappedParameters['from_zoom']
    const hasPixels = fields.some((field) => typeof parameters[field] === 'number')
    if (transform.fromZoom && hasPixels) {
      const nativeAction = action === 'type_text' ? 'click' : action
      if (!runtime.zoomCapableActions.has(nativeAction)) {
        throw new Error(`${action} cannot use zoom coordinates. Take a fresh full-window screenshot before this action.`)
      }
      mappedParameters['from_zoom'] = true
    }
    for (const field of fields) {
      const value = mappedParameters[field]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue
      }

      const axis = field.includes('x') ? 'x' : 'y'
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
    if (action !== 'get_window_state' && action !== 'get_desktop_state' && action !== 'zoom') return
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

  private rememberVisualStateId(
    input: ToolProviderExecutionInput,
    action: string,
    parameters: Record<string, unknown>,
    visualStateId: string | null
  ): void {
    if (
      !visualStateId ||
      (action !== 'get_window_state' && action !== 'get_desktop_state')
    ) {
      return
    }
    this.rememberVisualState(
      this.visualStateIds,
      this.getVisualTransformKey(input, parameters),
      visualStateId
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

  /** A rejected capture cannot justify reusing older coordinates or hashes. */
  private forgetVisualState(
    input: ToolProviderExecutionInput,
    parameters: Record<string, unknown>
  ): void {
    const key = this.getVisualTransformKey(input, parameters)
    this.visualTransforms.delete(key)
    this.visualStateIds.delete(key)
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
      hint: 'Use pid and window_id with current element tokens. Observe again after acting; old tokens expire. Increase max_elements/max_depth only if a needed control is omitted; query filters results, not traversal cost. elements_complete=false alone does not establish that this walk hit a limit.'
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
      ...(transform.fromZoom ? {
        zoomed: true,
        zoom_hint: 'This is a window crop. Click, drag, or type using its image pixels with the same pid/window_id; Leon applies native crop translation. For other pixel actions or another zoom, first get a full-window screenshot. Do not reuse coordinates from the earlier full-window image.'
      } : {}),
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
          include_screenshot: true,
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

    const structuredResult =
      parseJsonRecord(captureResult.structuredJson) ||
      parseJsonRecord(captureResult.rawJson)
    const failure = this.resultCompactor.getStructuredFailure(structuredResult)
    if (hasCuaError(captureResult) || failure) {
      const code = failure?.code || captureResult.errorCode || COMPUTER_USE_CAPTURE_FAILED_ERROR_CODE
      return this.failedCapture(input, captureParameters, code,
        failure?.message || captureResult.text, structuredResult || {})
    }
    // A closed dialog can return stale AX elements with a successful envelope.
    // Post-action evidence always needs a fresh frame; use the same recovery
    // path as an explicit capture failure instead of reusing those elements.
    if (structuredResult?.['screenshot_frame_valid'] === false || !captureResult.images.length) {
      return this.failedCapture(input, captureParameters,
        COMPUTER_USE_CAPTURE_FAILED_ERROR_CODE,
        'The resulting interface has no valid screenshot. Refresh the current target before using its pixels or element tokens.')
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
    this.rememberVisualStateId(
      input,
      captureAction,
      captureParameters,
      persistedImages.visualStateId
    )
    const observation = this.describeModelCoordinateSpace(
      {
        ...(compactedResult?.result || {
          text: this.artifactStore.buildTextPreview(captureResult.text)
        }),
        ...(persistedImages.visualStateId
          ? { visual_state_id: persistedImages.visualStateId }
          : {})
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
      modelFiles: persistedImages.modelFiles,
      visualStateId: persistedImages.visualStateId
    }
  }

  /** Retains capture failures as evidence without reclassifying delivered input. */
  private failedCapture(
    input: ToolProviderExecutionInput,
    parameters: Record<string, unknown>,
    code: string,
    message: string,
    result: Record<string, unknown> = {}
  ): CapturedComputerUseState {
    this.forgetVisualState(input, parameters)
    return {
      result: {
        ...result, success: false, error_code: code, message,
        recovery: this.getActionRecovery(result, parameters, code)
      },
      artifacts: [], modelFiles: [], visualStateId: null
    }
  }

  private getSuccessMessage(result: Record<string, unknown>): string {
    if (isComputerUseEffectUncertain(result['effect'])) {
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
