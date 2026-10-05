import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { FileHelper } from '@/helpers/file-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'

const MAX_PATHS = 100
const SEARCH_TIMEOUT_MS = 120_000
const MAX_RESULTS = 1_000
const EMPTY_CONFIG = 'ruleDirs: []\n'

/**
 * Read-only structural code search, with native AST locations and captures.
 */
export default class AstGrepTool extends Tool {
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)

  get toolName(): string {
    return 'ast-grep'
  }

  get toolkit(): string {
    return 'coding_development'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Find syntax patterns without rewrite flags or loading workspace grammars.
   */
  async search(pattern: string, paths: string[], language?: string): Promise<Record<string, unknown>> {
    if (typeof pattern !== 'string' || !pattern.trim() || pattern.includes('\0')) {
      throw new Error('pattern must be non-empty without NUL bytes')
    }
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_PATHS) {
      throw new Error(`Provide 1 to ${MAX_PATHS} local paths`)
    }
    if (language !== undefined && (typeof language !== 'string' || !language || language.includes('\0'))) {
      throw new Error('language must be a non-empty native ast-grep language name')
    }

    const resolved = await Promise.all(paths.map(async (input) => {
      if (typeof input !== 'string' || !input || input.includes('\0')) {
        throw new Error('Paths must be non-empty strings without NUL bytes')
      }

      const absolute = path.resolve(FileHelper.expandHomeAlias(input))
      const stat = await fs.stat(absolute)
      if (!stat.isFile() && !stat.isDirectory()) {
        throw new Error(`Not a regular file or directory: ${absolute}`)
      }

      return absolute
    }))
    const binary = await this.getBinaryPath('ast-grep')
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-ast-grep-'))

    try {
      // An explicit empty configuration prevents ambient project configuration
      // from loading custom native libraries during an ordinary read-only scan.
      const configPath = path.join(temporary, 'sgconfig.yml')
      await fs.writeFile(configPath, EMPTY_CONFIG)
      const args = ['run', '--config', configPath, '--json=compact', '--color', 'never', '--pattern', pattern]
      if (language) {
        args.push('--lang', language)
      }
      args.push('--', ...resolved)

      const output = await RuntimeHelper.runBinary(binary, args, {
        timeoutMs: SEARCH_TIMEOUT_MS,
        ...(this.executionContext?.signal ? { signal: this.executionContext.signal } : {}),
        successExitCodes: [0, 1]
      })
      const matches = JSON.parse(output || '[]') as Record<string, unknown>[]

      return {
        matches: matches.slice(0, MAX_RESULTS),
        paths: resolved,
        summary: { returnedRecords: Math.min(matches.length, MAX_RESULTS), complete: matches.length <= MAX_RESULTS },
        truncated: matches.length > MAX_RESULTS
      }
    } finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }
}
