import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { getPlatformName } from '@sdk/utils'
import {
  PROFILE_TOOLS_PATH,
  TOOLS_PATH
} from '@bridge/constants'

interface ToolConfig {
  tool_id: string
  toolkit_id: string
  name: string
  description: string
  binaries?: Record<string, string>
  resources?: Record<string, string[]>
  functions: Record<
    string,
    { description: string, input_schema: Record<string, string> }
  >
}

interface ToolkitConfigData {
  name: string
  description: string
  tools: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
}

function mergeMissingSettings(
  defaultSettings: Record<string, unknown>,
  existingSettings: Record<string, unknown>
): Record<string, unknown> {
  const mergedSettings = { ...existingSettings }

  for (const [key, defaultValue] of Object.entries(defaultSettings)) {
    const existingValue = existingSettings[key]

    if (!Object.prototype.hasOwnProperty.call(existingSettings, key)) {
      mergedSettings[key] = defaultValue
      continue
    }

    if (isPlainObject(defaultValue) && isPlainObject(existingValue)) {
      mergedSettings[key] = mergeMissingSettings(defaultValue, existingValue)
    }
  }

  return mergedSettings
}

export class ToolkitConfig {
  private static configCache = new Map<string, ToolkitConfigData>()
  private static settingsCache = new Map<string, Record<string, unknown>>()

  /**
   * Load tool configuration from the flat tools structure.
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
    const toolConfigPath = join(TOOLS_PATH, toolkitName, toolName, 'tool.json')

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
   */
  static loadToolSettings(
    toolkitName: string,
    toolName: string,
    defaults: Record<string, unknown> = {}
  ): Record<string, unknown> {
    const cacheKey = `${toolkitName}:${toolName}`
    if (this.settingsCache.has(cacheKey)) {
      return this.settingsCache.get(cacheKey) || {}
    }

    const settingsPath = join(
      PROFILE_TOOLS_PATH,
      toolkitName,
      toolName,
      'settings.json'
    )
    const settingsSamplePath = join(
      TOOLS_PATH,
      toolkitName,
      toolName,
      'settings.sample.json'
    )
    const settingsDir = dirname(settingsPath)
    const defaultSettings = existsSync(settingsSamplePath)
      ? (JSON.parse(
        readFileSync(settingsSamplePath, 'utf-8')
      ) as Record<string, unknown>)
      : defaults

    mkdirSync(settingsDir, { recursive: true })

    let toolSettings: Record<string, unknown> = {}
    let shouldWrite = false

    if (existsSync(settingsPath)) {
      const settingsContent = readFileSync(settingsPath, 'utf-8')
      toolSettings = JSON.parse(settingsContent) as Record<string, unknown>
    } else {
      shouldWrite = true
    }

    const mergedSettings = mergeMissingSettings(defaultSettings, toolSettings)

    if (!shouldWrite) {
      shouldWrite = JSON.stringify(toolSettings) !== JSON.stringify(mergedSettings)
    }

    if (shouldWrite) {
      writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2))
    }

    this.settingsCache.set(cacheKey, mergedSettings)
    return mergedSettings
  }

  /**
   * Get binary download URL for current platform with architecture granularity
   */
  static getBinaryUrl(config: ToolConfig): string | undefined {
    const platformName = getPlatformName()

    return config.binaries?.[platformName]
  }
}
