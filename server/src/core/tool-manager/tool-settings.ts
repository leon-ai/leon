import path from 'node:path'

import { ToolSettingsStore, type ToolSettingsPaths } from '@@/bridges/runtime/nodejs/tool-settings'
import { CODEBASE_PATH, resolveToolDirectory } from '@/leon-roots'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'

/**
 * Core settings access supplies profile paths without importing a tool SDK.
 */
export class ToolSettings {
  /**
   * Load defaults and owner settings for the explicitly selected profile.
   */
  public static loadToolSettings(
    toolkitId: string,
    toolId: string,
    defaults: Record<string, unknown> = {},
    refresh = false,
    profileName = getActiveProfileName()
  ): Record<string, unknown> {
    return ToolSettingsStore.load(
      this.paths(toolkitId, toolId, profileName),
      defaults,
      refresh
    )
  }

  /**
   * Save edits while retaining unrelated settings and private file permissions.
   */
  public static saveToolSettings(
    toolkitId: string,
    toolId: string,
    values: Record<string, unknown>,
    profileName = getActiveProfileName()
  ): void {
    ToolSettingsStore.save(
      this.paths(toolkitId, toolId, profileName),
      values
    )
  }

  /**
   * Keep owner state in the profile and defaults in the owning tool source.
   */
  private static paths(
    toolkitId: string,
    toolId: string,
    profileName: string
  ): ToolSettingsPaths {
    return {
      settings: path.join(getProfilePaths(profileName).tools, toolkitId, toolId, 'settings.json'),
      sample: path.join(
        resolveToolDirectory(path.join(CODEBASE_PATH, 'tools'), toolkitId, toolId),
        'settings.sample.json'
      )
    }
  }
}
