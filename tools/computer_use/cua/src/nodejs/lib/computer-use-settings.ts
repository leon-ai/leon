import { type CuaExecutionContext as ToolExecutionContext,
  ComputerUseInteractionMode,
  ComputerUseSetOfMarkMode,
  type ComputerUseActivityOverlayResolver,
  type ComputerUseInteractionModeResolver,
  type ComputerUseSetOfMarkModeResolver,
  type PreferredApplicationsResolver
} from './types'
import { ToolkitConfig } from '@sdk/toolkit-config'

import {
  COMPUTER_USE_ACTIVITY_OVERLAY_SETTING,
  COMPUTER_USE_BROWSER_INSPECTION_SETTING,
  COMPUTER_USE_INTERACTION_MODE_SETTING,
  COMPUTER_USE_PREFERRED_APPS_SETTING,
  COMPUTER_USE_SET_OF_MARK_SETTING
} from './constants'
import { asRecord } from './utils'

function readComputerUseSettings(input: ToolExecutionContext): Record<string, unknown> {
  if (input.getSettings) return input.getSettings()
  return ToolkitConfig.loadToolSettings(input.toolkitId, input.toolId, {}, true, input.profileName)
}

export const resolveComputerUseInteractionMode: ComputerUseInteractionModeResolver =
  (input) =>
    readComputerUseSettings(input)[COMPUTER_USE_INTERACTION_MODE_SETTING] ===
    ComputerUseInteractionMode.Background
      ? ComputerUseInteractionMode.Background
      : ComputerUseInteractionMode.Visible

export const resolveComputerUseActivityOverlay: ComputerUseActivityOverlayResolver =
  (input) =>
    asRecord(
      readComputerUseSettings(input)[COMPUTER_USE_ACTIVITY_OVERLAY_SETTING]
    )?.['enabled'] !== false

export const resolveComputerUseSetOfMarkMode: ComputerUseSetOfMarkModeResolver =
  (input) => {
    const mode = asRecord(
      readComputerUseSettings(input)[COMPUTER_USE_SET_OF_MARK_SETTING]
    )?.['mode']

    return Object.values(ComputerUseSetOfMarkMode).includes(
      mode as ComputerUseSetOfMarkMode
    )
      ? mode as ComputerUseSetOfMarkMode
      : ComputerUseSetOfMarkMode.Auto
  }

export const resolvePreferredApplications: PreferredApplicationsResolver =
  (input) => {
    const preferredApps = asRecord(
      readComputerUseSettings(input)[COMPUTER_USE_PREFERRED_APPS_SETTING]
    )
    if (!preferredApps) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(preferredApps).flatMap(([activity, appName]) => {
        const normalizedActivity = activity.trim()
        const normalizedAppName =
          typeof appName === 'string' ? appName.trim() : ''
        return normalizedActivity && normalizedAppName
          ? [[normalizedActivity, normalizedAppName]]
          : []
      })
    )
  }

/**
 * Reads the owner's explicit grant; model tool arguments cannot grant profile access.
 */
export function resolveComputerUseBrowserInspection(input: ToolExecutionContext): boolean {
  return asRecord(readComputerUseSettings(input)[COMPUTER_USE_BROWSER_INSPECTION_SETTING])?.['allow_existing_profile'] === true
}
