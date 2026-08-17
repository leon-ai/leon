import fs from 'node:fs'
import path from 'node:path'

import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import type { ToolProviderExecutionInput } from '@/core/tool-provider/types'

import {
  COMPUTER_USE_INTERACTION_MODE_SETTING,
  COMPUTER_USE_PREFERRED_APPS_SETTING
} from './constants'
import {
  ComputerUseInteractionMode,
  type ComputerUseInteractionModeResolver,
  type PreferredApplicationsResolver
} from './types'
import { asRecord } from './utils'

function readComputerUseSettings(
  input: ToolProviderExecutionInput
): Record<string, unknown> {
  const settingsPath = path.join(
    getProfilePaths(input.profileName).tools,
    input.toolkitId,
    input.toolId,
    'settings.json'
  )

  try {
    return asRecord(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))) || {}
  } catch {
    return {}
  }
}

export const resolveComputerUseInteractionMode: ComputerUseInteractionModeResolver =
  (input) =>
    readComputerUseSettings(input)[COMPUTER_USE_INTERACTION_MODE_SETTING] ===
    ComputerUseInteractionMode.Visible
      ? ComputerUseInteractionMode.Visible
      : ComputerUseInteractionMode.Background

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
