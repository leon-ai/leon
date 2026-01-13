import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getPlatformName } from '@sdk/utils'

interface ToolConfig {
  description: string
  binaries?: Record<string, string>
  resources?: Record<string, string[]>
}

interface ToolkitConfigData {
  name: string
  description: string
  tools: Record<string, ToolConfig>
}

export class ToolkitConfig {
  private static configCache = new Map<string, ToolkitConfigData>()

  /**
   * Load tool configuration from bridges/toolkits directory
   * @param toolkitName - The toolkit name (e.g., 'video_streaming')
   * @param toolName - Name of the tool (e.g., 'ffmpeg')
   */
  static load(toolkitName: string, toolName: string): ToolConfig {
    const cacheKey = toolkitName

    // Load toolkit config if not cached
    if (!this.configCache.has(cacheKey)) {
      const configPath = join(
        process.cwd(),
        'bridges',
        'toolkits',
        toolkitName,
        'toolkit.json'
      )
      const configContent = readFileSync(configPath, 'utf-8')
      const config = JSON.parse(configContent) as ToolkitConfigData

      this.configCache.set(cacheKey, config)
    }

    const toolkitConfig = this.configCache.get(cacheKey)!
    const toolConfig = toolkitConfig.tools[toolName]

    if (!toolConfig) {
      throw new Error(
        `Tool '${toolName}' not found in toolkit '${toolkitConfig.name}'`
      )
    }

    return toolConfig
  }

  /**
   * Get binary download URL for current platform with architecture granularity
   */
  static getBinaryUrl(config: ToolConfig): string | undefined {
    const platformName = getPlatformName()

    return config.binaries?.[platformName]
  }
}
