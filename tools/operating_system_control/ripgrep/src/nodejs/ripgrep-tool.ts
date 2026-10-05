import fs from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { FileHelper } from '@/helpers/file-helper'

import { runRipgrep } from './lib/run-ripgrep'

const MAX_PATHS = 100
const MAX_GLOBS = 100
const MAX_RECORDS = 100_000
const SEARCH_TIMEOUT_MS = 120_000
const THREADS = 0
const FILENAME_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

export enum SearchResultMode {
  Matches = 'matches',
  Files = 'files',
  Count = 'count'
}

interface FileOptions {
  globs?: string[]
  hidden?: boolean
  noIgnore?: boolean
  ignoreCase?: boolean
}

interface SearchOptions extends FileOptions {
  regex?: boolean
  resultMode?: SearchResultMode
}

interface TextData {
  text?: string
  bytes?: string
}

interface MatchData {
  path: TextData
  lines: TextData
  line_number: number
  absolute_offset: number
  submatches: { match: TextData, start: number, end: number }[]
}

interface SearchResult {
  matches?: MatchData[]
  files?: TextData[]
  count?: number
  paths: string[]
  truncated: boolean
  reason: string | null
  summary: { returnedRecords: number, complete: boolean }
}

/**
 * Search local content and discover files using bounded, shell-free ripgrep.
 */
export default class RipgrepTool extends Tool {
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)

  get toolName(): string {
    return 'ripgrep'
  }

  get toolkit(): string {
    return 'operating_system_control'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Choose rg's native output mode instead of collecting lines for file/count requests.
   */
  async search(pattern: string, paths: string[], options: SearchOptions = {}): Promise<SearchResult> {
    if (typeof pattern !== 'string' || pattern.includes('\0')) {
      throw new Error('pattern must be a string without NUL bytes')
    }

    const prepared = await this.prepare(paths, options, options?.ignoreCase ?? false)
    const mode = options.resultMode ?? SearchResultMode.Matches
    if (!Object.values(SearchResultMode).includes(mode)) {
      throw new Error('resultMode must be matches, files or count')
    }
    if (options.regex !== undefined && typeof options.regex !== 'boolean') {
      throw new Error('regex must be a boolean')
    }

    let count = 0
    const args = [...prepared.args]
    let separator = 10

    if (mode === SearchResultMode.Matches) {
      args.push('--json')
    } else if (mode === SearchResultMode.Files) {
      args.push('--files-with-matches', '--null')
      separator = 0
    } else {
      // Without filenames, each complete record is a matching-line count for
      // one file. This stays small even when files contain millions of hits.
      args.push('--count', '--no-filename')
    }
    if (options.ignoreCase) {
      args.push('--ignore-case')
    }
    if (!options.regex) {
      args.push('--fixed-strings')
    }
    args.push('--regexp', pattern, '--', ...prepared.paths)

    if (mode === SearchResultMode.Count) {
      const outcome = await this.run(args, separator, (record) => {
        const fileCount = Number(record.toString('ascii'))
        if (!Number.isSafeInteger(fileCount) || fileCount < 0 || !Number.isSafeInteger(count + fileCount)) {
          throw new Error('Invalid ripgrep count record')
        }
        count += fileCount
        return true
      })

      return {
        count,
        paths: prepared.paths,
        summary: { returnedRecords: count, complete: !outcome.truncated },
        ...outcome
      }
    }

    return this.collect(
      args,
      separator,
      prepared.paths,
      mode === SearchResultMode.Files ? 'files' : 'matches',
      (record) => {
        if (mode === SearchResultMode.Files) {
          return this.filename(record)
        }

        const event = JSON.parse(record.toString('utf8')) as { type: string, data: MatchData }

        return event.type === 'match' ? event.data : null
      }
    )
  }

  /**
   * Discover filenames with bounded native ripgrep output.
   */
  async listFiles(paths: string[], options: FileOptions = {}): Promise<SearchResult> {
    const prepared = await this.prepare(paths, options, options?.ignoreCase ?? true)
    return this.collect(
      [...prepared.args, '--files', '--null', '--', ...prepared.paths],
      0,
      prepared.paths,
      'files',
      (record) => this.filename(record)
    )
  }

  /**
   * Collect bounded native records without parsing shell output.
   */
  private async collect(
    args: string[],
    separator: number,
    paths: string[],
    field: 'files' | 'matches',
    decode: (record: Buffer) => TextData | MatchData | null
  ): Promise<SearchResult> {
    const records: (TextData | MatchData)[] = []
    const outcome = await this.run(args, separator, (record) => {
      const value = decode(record)

      if (value === null) {
        return true
      }
      if (records.length >= MAX_RECORDS) {
        return false
      }

      records.push(value)
      return true
    })

    return {
      [field]: records,
      paths,
      summary: { returnedRecords: records.length, complete: !outcome.truncated },
      ...outcome
    }
  }

  private filename(record: Buffer): TextData {
    // Non-UTF-8 names must remain lossless, as in rg's JSON text/bytes format.
    try {
      return { text: FILENAME_DECODER.decode(record) }
    } catch {
      return { bytes: record.toString('base64') }
    }
  }

  private async prepare(paths: string[], options: FileOptions, insensitiveGlobs: boolean): Promise<{
    args: string[]
    paths: string[]
  }> {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS) {
      throw new Error(`Provide 1 to ${MAX_PATHS} file or directory paths`)
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('options must be an object')
    }
    for (const key of ['hidden', 'noIgnore', 'ignoreCase'] as const) {
      if (options[key] !== undefined && typeof options[key] !== 'boolean') {
        throw new Error(`${key} must be a boolean`)
      }
    }

    const resolved = await Promise.all(paths.map(async (input) => {
      if (typeof input !== 'string' || !input || input.includes('\0')) {
        throw new Error('Paths must be non-empty strings without NUL bytes')
      }
      const absolute = path.resolve(FileHelper.expandHomeAlias(input))
      const stat = await fs.stat(absolute)
      if (!stat.isDirectory() && !stat.isFile()) {
        throw new Error(`Not a regular file or directory: ${absolute}`)
      }
      return absolute
    }))

    // Disable ambient configuration, including arbitrary preprocessors.
    const args = ['--no-config', '--color', 'never', '--threads', String(THREADS)]
    if (options.hidden) {
      args.push('--hidden')
    }
    if (options.noIgnore) {
      args.push('--no-ignore')
    }
    if (options.globs !== undefined) {
      if (!Array.isArray(options.globs) || options.globs.length > MAX_GLOBS) {
        throw new Error(`globs must be an array of at most ${MAX_GLOBS} strings`)
      }
      for (const glob of options.globs) {
        if (typeof glob !== 'string' || glob.includes('\0')) {
          throw new Error('Each glob must be a string without NUL bytes')
        }
        args.push(insensitiveGlobs ? '--iglob' : '--glob', glob)
      }
    }

    return { args, paths: resolved }
  }

  private async run(
    args: string[],
    separator: number,
    consume: (record: Buffer) => boolean
  ): Promise<{
    truncated: boolean
    reason: string | null
  }> {
    const binary = await this.getBinaryPath('rg')
    const group = `${this.toolkit}_${this.toolName}_${Date.now()}`
    await this.report('bridges.tools.executing_command', {
      binary_name: 'rg', command: JSON.stringify([binary, ...args])
    }, group)

    const started = Date.now()
    const outcome = await runRipgrep(binary, args, SEARCH_TIMEOUT_MS, separator, consume, this.executionContext?.signal)
    await this.report('bridges.tools.command_completed', {
      command: 'rg', execution_time: `${Date.now() - started}ms`
    }, group)

    return outcome
  }
}
