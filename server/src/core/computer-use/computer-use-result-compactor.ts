import type { ToolProviderExecutionInput } from '@/core/tool-provider/types'

import {
  COMPUTER_USE_APP_QUERY_PARAMETER,
  COMPUTER_USE_APP_RESULT_LIMIT,
  COMPUTER_USE_APP_WINDOW_LIMIT,
  COMPUTER_USE_BROWSER_REF_LIMIT,
  COMPUTER_USE_WINDOW_RESULT_LIMIT
} from './constants'
import type {
  CompactedComputerUseResult,
  PreferredApplicationsResolver,
  StructuredComputerUseFailure
} from './types'
import { asRecord, hasText } from './utils'

/** Compacts driver payloads into bounded, model-facing observations. */
export class ComputerUseResultCompactor {
  public constructor(
    private readonly preferredApplicationsResolver: PreferredApplicationsResolver
  ) {}

  public compact(
    input: ToolProviderExecutionInput,
    action: string,
    result: Record<string, unknown>
  ): CompactedComputerUseResult {
    if (action === 'list_apps' && Array.isArray(result['apps'])) {
      return this.compactApplicationResult(input, result)
    }
    if (action === 'list_windows' && Array.isArray(result['windows'])) {
      return this.compactWindowResult(result)
    }
    if (
      action === 'get_browser_state' &&
      (Array.isArray(result['refs']) || Array.isArray(result['content_refs']))
    ) {
      return this.compactBrowserResult(result)
    }

    return { result, changed: false }
  }

  public getStructuredFailure(
    result: Record<string, unknown> | null
  ): StructuredComputerUseFailure | null {
    const refusal = asRecord(result?.['refusal'])
    if (refusal) {
      return {
        ...(hasText(refusal['code']) ? { code: refusal['code'] } : {}),
        message: hasText(refusal['message'])
          ? refusal['message']
          : 'Computer-use action was refused.'
      }
    }

    const escalation = asRecord(result?.['escalation'])
    if (!escalation || !hasText(result?.['code'])) {
      return null
    }

    // A structured escalation is a refusal even when the process exited cleanly.
    const message = [
      result?.['detail'],
      result?.['suggestion'],
      escalation['reason']
    ].find((value) => hasText(value))

    return {
      code: result['code'],
      message: hasText(message)
        ? message
        : 'Computer-use action requires a different execution mode.'
    }
  }

  private compactWindowResult(
    result: Record<string, unknown>
  ): CompactedComputerUseResult {
    const allWindows = (result['windows'] as unknown[])
      .map(asRecord)
      .filter((window): window is Record<string, unknown> => window !== null)
    const windows = allWindows
      .slice(0, COMPUTER_USE_WINDOW_RESULT_LIMIT)
      .map((window) =>
        Object.fromEntries(
          Object.entries({
            window_id: window['window_id'],
            pid: window['pid'],
            app_name: window['app_name'],
            title: window['title'],
            is_on_screen: window['is_on_screen'],
            active: window['active'],
            focused: window['focused'],
            minimized: window['minimized'],
            z_index: window['z_index'],
            bounds: window['bounds'],
            x: window['x'],
            y: window['y'],
            width: window['width'],
            height: window['height']
          }).filter(([, value]) => value !== undefined)
        )
      )

    return {
      result: {
        windows,
        total_window_count: allWindows.length,
        returned_window_count: windows.length,
        omitted_window_count: allWindows.length - windows.length
      },
      changed: true
    }
  }

  private compactApplicationResult(
    input: ToolProviderExecutionInput,
    result: Record<string, unknown>
  ): CompactedComputerUseResult {
    const allApps = (result['apps'] as unknown[])
      .map(asRecord)
      .filter((app): app is Record<string, unknown> => app !== null)
    const desktopApps = allApps.filter((app) => {
      const windows = app['windows']
      return (
        app['active'] === true ||
        (Array.isArray(windows) && windows.length > 0) ||
        hasText(app['bundle_id']) ||
        hasText(app['kind']) ||
        hasText(app['launch_path'])
      )
    })
    const candidates = desktopApps.length > 0 ? desktopApps : allApps
    const query = input.parameters[COMPUTER_USE_APP_QUERY_PARAMETER]
    const normalizedQuery =
      typeof query === 'string' ? query.trim().toLocaleLowerCase() : ''
    const matchingCandidates = normalizedQuery
      ? candidates.filter((app) =>
          [app['name'], app['bundle_id'], app['launch_path']].some(
            (value) =>
              hasText(value) &&
              value.toLocaleLowerCase().includes(normalizedQuery)
          )
        )
      : candidates
    const preferredApplications = this.preferredApplicationsResolver(input)
    const availablePreferredActivities = new Set<string>()
    const seenApps = new Set<string>()
    const uniqueApps = matchingCandidates
      .map((app) => {
        const preferredFor = this.getPreferredActivities(
          app,
          preferredApplications
        )
        for (const activity of preferredFor) {
          availablePreferredActivities.add(activity)
        }
        return preferredFor.length > 0
          ? { ...app, preferred_for: preferredFor }
          : app
      })
      .filter((app) => {
        const identity = JSON.stringify([
          app['name'],
          app['bundle_id'],
          app['launch_path']
        ])
        if (seenApps.has(identity)) {
          return false
        }
        seenApps.add(identity)
        return true
      })
      .sort((appA, appB) => {
        const appAPreferred = Array.isArray(appA['preferred_for']) ? 1 : 0
        const appBPreferred = Array.isArray(appB['preferred_for']) ? 1 : 0
        return appBPreferred - appAPreferred
      })
    const apps = uniqueApps
      .slice(0, COMPUTER_USE_APP_RESULT_LIMIT)
      .map((app) => this.compactApplication(app))
    const preferredApps = Object.entries(preferredApplications).map(
      ([activity, appName]) => ({
        activity,
        app_name: appName,
        available: availablePreferredActivities.has(activity)
      })
    )

    return {
      result: {
        apps,
        ...(preferredApps.length > 0 ? { preferred_apps: preferredApps } : {}),
        total_app_count: allApps.length,
        matched_app_count: uniqueApps.length,
        returned_app_count: apps.length,
        omitted_app_count: uniqueApps.length - apps.length
      },
      changed: true
    }
  }

  private compactApplication(
    app: Record<string, unknown>
  ): Record<string, unknown> {
    const windows = Array.isArray(app['windows'])
      ? app['windows']
          .map(asRecord)
          .filter((window): window is Record<string, unknown> => window !== null)
          .slice(0, COMPUTER_USE_APP_WINDOW_LIMIT)
          .map((window) => ({
            window_id: window['window_id'],
            title: window['title'],
            is_on_screen: window['is_on_screen'],
            active: window['active']
          }))
      : []

    return Object.fromEntries(
      Object.entries({
        name: app['name'],
        bundle_id: app['bundle_id'],
        launch_path: app['launch_path'],
        running: app['running'],
        active: app['active'],
        last_used: app['last_used'],
        preferred_for: app['preferred_for'],
        ...(windows.length > 0 ? { windows } : {})
      }).filter(([, value]) => value !== undefined)
    )
  }

  private getPreferredActivities(
    app: Record<string, unknown>,
    preferredApplications: Record<string, string>
  ): string[] {
    const appIdentities = [app['name'], app['bundle_id'], app['launch_path']]
      .filter((value): value is string => hasText(value))
      .map((value) => value.toLocaleLowerCase())

    return Object.entries(preferredApplications).flatMap(
      ([activity, appName]) =>
        appIdentities.includes(appName.toLocaleLowerCase()) ? [activity] : []
    )
  }

  private compactBrowserResult(
    result: Record<string, unknown>
  ): CompactedComputerUseResult {
    const refs = Array.isArray(result['refs']) ? result['refs'] : []
    const contentRefs = Array.isArray(result['content_refs'])
      ? result['content_refs']
      : []
    const compactedRefs = this.compactBrowserReferences(refs)
    const compactedContentRefs = this.compactBrowserReferences(contentRefs)
    const outline = result['outline']
    const hasOutline = typeof outline === 'string' && outline.length > 0

    const browserState = { ...result }
    delete browserState['refs']
    delete browserState['content_refs']
    delete browserState['outline']

    return {
      result: {
        ...browserState,
        refs: compactedRefs,
        content_refs: compactedContentRefs,
        omitted_ref_count: refs.length - compactedRefs.length,
        omitted_content_ref_count:
          contentRefs.length - compactedContentRefs.length
      },
      changed:
        hasOutline ||
        compactedRefs.length !== refs.length ||
        compactedContentRefs.length !== contentRefs.length
    }
  }

  private compactBrowserReferences(
    values: unknown[]
  ): Record<string, unknown>[] {
    return values
      .map(asRecord)
      .filter((reference): reference is Record<string, unknown> => {
        if (!reference || !hasText(reference['ref'])) {
          return false
        }
        return hasText(reference['name']) || hasText(reference['value'])
      })
      .slice(0, COMPUTER_USE_BROWSER_REF_LIMIT)
      .map((reference) => ({
        ref: reference['ref'],
        role: reference['role'],
        name: reference['name'],
        value: reference['value'],
        actions: reference['actions'],
        states: reference['states'],
        visibility: reference['visibility'],
        frame: reference['frame']
      }))
  }
}
