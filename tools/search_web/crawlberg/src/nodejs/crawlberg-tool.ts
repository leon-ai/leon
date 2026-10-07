import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { ToolRuntimeLifetime } from '@bridge/tool-runtime-types'

import { UrlReader, type UrlReadOptions } from './lib/url-reader'

/**
 * Provider-independent URL extraction with locally cached source snapshots.
 */
export default class CrawlbergTool extends Tool {
  public readonly runtimeLifetime = ToolRuntimeLifetime.Persistent
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)
  private readonly reader = new UrlReader()

  get toolName(): string {
    return 'crawlberg'
  }

  get toolkit(): string {
    return 'search_web'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Fetch one page or remote document without invoking an LLM provider.
   */
  public async fetchUrl(url: string, options: UrlReadOptions = {}): Promise<Record<string, unknown>> {
    try {
      return { success: true, data: await this.reader.read(url, options) }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Release retained source text with the profile-owned worker.
   */
  public async dispose(): Promise<void> {
    this.reader.dispose()
  }
}
