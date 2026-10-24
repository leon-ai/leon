import type { ToolConnectionSchema } from '@/schemas/tool-schemas'
import type { ToolConcurrency } from '@/types'
import {
  LEON_PROFILE_NAME,
  LEON_PROFILES_PATH,
  isValidProfileName,
  resolveToolDirectory
} from '@/leon-roots'
import { ToolSettingsStore, type ToolSettingsPaths } from '@@/bridges/runtime/nodejs/tool-settings'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { getPlatformName } from '@sdk/utils/platform'
import {
  TOOLS_PATH
} from '@bridge/constants'

interface ToolConfig {
  tool_id: string
  toolkit_id: string
  name: string
  description: string
  concurrency?: ToolConcurrency
  binaries?: Record<string, string>
  resources?: Record<string, string[]>
  connection?: ToolConnectionSchema
  functions: Record<
    string,
    {
      description: string
      parameters: Record<string, unknown>
      background?: boolean
    }
  >
}

interface ToolkitConfigData {
  name: string
  description: string
  tools: string[]
}

export class ToolkitConfig {
  private static configCache = new Map<string, ToolkitConfigData>()

  /**
   * Load tool configuration from its toolkit/tool directory.
   * @param toolkitName - The toolkit name (e.g., 'video_streaming')
   * @param toolName - Name of the tool (e.g., 'ffmpeg')
   */
  static load(toolkitName: string, toolName: string): ToolConfig {
    const cacheKey = toolkitName

    // Load toolkit config if not cached
    if (!this.configCache.has(cacheKey)) {
      const configPath = join(TOOLS_PATH, toolkitName, 'toolkit.json')
      const configContent = readFileSync(configPath, 'utf-8')
      const config = JSON.parse(configContent) as ToolkitConfigData

      this.configCache.set(cacheKey, config)
    }

    const toolkitConfig = this.configCache.get(cacheKey)!
    const toolConfigPath = join(resolveToolDirectory(TOOLS_PATH, toolkitName, toolName), 'tool.json')

    if (!toolkitConfig.tools.includes(toolName) && !existsSync(toolConfigPath)) {
      throw new Error(
        `Tool '${toolName}' not found in toolkit '${toolkitConfig.name}'`
      )
    }

    const toolConfigContent = readFileSync(toolConfigPath, 'utf-8')
    const toolConfig = JSON.parse(toolConfigContent) as ToolConfig

    return toolConfig
  }

  /**
   * Load tool-specific settings from toolkit settings file
   * @param toolkitName - The toolkit name (e.g., 'video_streaming')
   * @param toolName - Name of the tool (e.g., 'ffmpeg')
   * @param defaults - Default tool settings to apply when missing
   * @param refresh - Reload settings after owner edits
   * @param profileName - Owning profile, independent of the active conversation
   */
  static loadToolSettings(
    toolkitName: string,
    toolName: string,
    defaults: Record<string, unknown> = {},
    refresh = false,
    profileName = LEON_PROFILE_NAME
  ): Record<string, unknown> {
    return ToolSettingsStore.load(
      this.getSettingsPaths(toolkitName, toolName, profileName),
      defaults,
      refresh
    )
  }

  /**
   * Merges owner edits into profile tool settings and atomically replaces the file.
   */
  static saveToolSettings(
    toolkitName: string,
    toolName: string,
    values: Record<string, unknown>,
    profileName = LEON_PROFILE_NAME
  ): void {
    ToolSettingsStore.save(
      this.getSettingsPaths(toolkitName, toolName, profileName),
      values
    )
  }

  /**
   * Resolve SDK settings from explicit host paths without loading Core services.
   */
  private static getSettingsPaths(
    toolkitName: string,
    toolName: string,
    profileName: string
  ): ToolSettingsPaths {
    if (!isValidProfileName(profileName)) {
      throw new Error(`Invalid Leon profile name "${profileName}".`)
    }

    return {
      settings: join(
        LEON_PROFILES_PATH,
        profileName.trim(),
        'tools',
        toolkitName,
        toolName,
        'settings.json'
      ),
      sample: join(
        resolveToolDirectory(TOOLS_PATH, toolkitName, toolName),
        'settings.sample.json'
      )
    }
  }

  /**
   * Get binary download URL for current platform with architecture granularity
   */
  static getBinaryUrl(config: ToolConfig): string | undefined {
    const platformName = getPlatformName()

    return config.binaries?.[platformName]
  }
}
