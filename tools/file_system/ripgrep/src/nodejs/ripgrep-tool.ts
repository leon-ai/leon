import fs from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { randomUUID } from 'node:crypto'

import { PROFILE_SESSIONS_PATH } from '@bridge/constants'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { FileHelper } from '@/helpers/file-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { getRemoteSearchRoots, localSearchCommand, localSearchScope } from '@@/bridges/runtime/nodejs/local-search'

import { runRipgrep } from './lib/run-ripgrep'

const MAX_PATHS = 100
const MAX_GLOBS = 100
const MAX_RECORDS = 1_000_000
const MAX_RETAINED_BYTES = 128 * 1_024 * 1_024
const MAX_PREVIEW_RECORDS = 100
const MAX_PREVIEW_BYTES = 32_000
const MAX_MATCH_PREVIEW_RECORDS = 24
const MAX_MATCH_PREVIEW_BYTES = 8_000
const WRITE_BUFFER_BYTES = 64 * 1_024
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
  skippedPaths?: string[]
  truncated: boolean
  reason: string | null
  summary: { returnedRecords: number, complete: boolean }
  preview?: { returnedRecords: number, truncated: boolean }
  retainedOutput?: { path: string }
}

interface PreparedSearch {
  args: string[]
  paths: string[]
  localPaths: string[]
  skippedPaths: string[]
  cwd?: string
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
    return 'file_system'
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
    args.push('--regexp', pattern, '--', ...prepared.localPaths)

    if (mode === SearchResultMode.Count) {
      const outcome = await this.run(args, separator, prepared, (record) => {
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
        ...(prepared.skippedPaths.length ? { skippedPaths: prepared.skippedPaths } : {}),
        summary: { returnedRecords: count, complete: !outcome.truncated },
        ...outcome
      }
    }

    return this.collect(
      args,
      separator,
      prepared,
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
   * Save the inventory on disk while returning only a small inline preview.
   */
  async listFiles(paths: string[], options: FileOptions = {}): Promise<SearchResult> {
    const prepared = await this.prepare(paths, options, options?.ignoreCase ?? true)
    return this.collect(
      [...prepared.args, '--files', '--null', '--', ...prepared.localPaths],
      0,
      prepared,
      'files',
      (record) => this.filename(record)
    )
  }

  /**
   * Keep the worker result small without limiting the saved search inventory.
   */
  private async collect(
    args: string[],
    separator: number,
    prepared: PreparedSearch,
    field: 'files' | 'matches',
    decode: (record: Buffer) => TextData | MatchData | null
  ): Promise<SearchResult> {
    const sessionId = this.executionContext?.conversationSessionId

    if (!sessionId) {
      throw new Error('Retained search results require a conversation session.')
    }

    const directory = path.join(
      PROFILE_SESSIONS_PATH,
      encodeURIComponent(sessionId),
      'artifacts',
      'tool-results'
    )
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const filename = path.join(directory, `${randomUUID()}.json`)
    const file = await fs.open(filename, 'wx', 0o600)
    const preview: (TextData | MatchData)[] = []
    const maxPreviewRecords = field === 'matches' ? MAX_MATCH_PREVIEW_RECORDS : MAX_PREVIEW_RECORDS
    const maxPreviewBytes = field === 'matches' ? MAX_MATCH_PREVIEW_BYTES : MAX_PREVIEW_BYTES
    let previewBytes = 0
    let retainedBytes = 0
    let records = 0
    let buffer = ''
    let bufferedBytes = 0

    try {
      await file.writeFile(`{"result":{"${field}":[`)
      const outcome = await this.run(args, separator, prepared, async (record) => {
        const value = decode(record)

        if (value === null) {
          return true
        }

        const serialized = JSON.stringify(value)
        const bytes = Buffer.byteLength(serialized) + 1

        if (records >= MAX_RECORDS || retainedBytes + bytes > MAX_RETAINED_BYTES) {
          return false
        }

        buffer += `${records > 0 ? ',' : ''}${serialized}`
        bufferedBytes += bytes
        retainedBytes += bytes
        records += 1

        if (
          preview.length < maxPreviewRecords &&
          previewBytes + bytes <= maxPreviewBytes
        ) {
          preview.push(value)
          previewBytes += bytes
          this.emitOutput(`${serialized}\n`)
        }

        // Batch writes rather than issuing one filesystem operation per path.
        if (bufferedBytes >= WRITE_BUFFER_BYTES) {
          await file.writeFile(buffer)
          buffer = ''
          bufferedBytes = 0
        }

        return true
      })

      // Cancellation does not publish an orphaned partial inventory.
      this.executionContext?.signal?.throwIfAborted()

      const metadata = {
        paths: prepared.paths,
        ...(prepared.skippedPaths.length ? { skippedPaths: prepared.skippedPaths } : {}),
        summary: { returnedRecords: records, complete: !outcome.truncated },
        ...outcome
      }

      await file.writeFile(`${buffer}],${JSON.stringify(metadata).slice(1)}}`)
      await file.close()

      return {
        [field]: preview,
        ...metadata,
        preview: { returnedRecords: preview.length, truncated: preview.length < records },
        retainedOutput: { path: filename }
      }
    } catch (error) {
      await file.close()
      await fs.rm(filename, { force: true })
      throw error
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

  private async prepare(paths: string[], options: FileOptions, insensitiveGlobs: boolean): Promise<PreparedSearch> {
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

    const resolved = paths.map((input) => {
      if (typeof input !== 'string' || !input || input.includes('\0')) {
        throw new Error('Paths must be non-empty strings without NUL bytes')
      }
      return path.resolve(FileHelper.expandHomeAlias(input))
    })

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

    const remoteRoots = await getRemoteSearchRoots(this.executionContext?.signal)
    // Root-specific user globs must keep their original working-directory semantics.
    const canExcludeDescendants = !options.globs?.some((glob) => glob.includes('/') || glob.includes('\\'))
    const initialScope = localSearchScope(resolved, remoteRoots, canExcludeDescendants)
    // On macOS even a metadata lookup can materialize intermediate folders.
    const canonical = process.platform === 'darwin' ? initialScope.paths : await Promise.all(initialScope.paths.map(async (source) => {
      const actual = remoteRoots.length ? await fs.realpath(source) : source
      const stat = await fs.stat(actual)
      if (!stat.isDirectory() && !stat.isFile()) {
        throw new Error(`Not a regular file or directory: ${source}`)
      }
      return actual
    }))
    const scope = localSearchScope(canonical, remoteRoots, canExcludeDescendants)
    for (const glob of scope.globs) {
      args.push(insensitiveGlobs || process.platform === 'win32' ? '--iglob' : '--glob', glob)
    }

    return {
      args,
      paths: resolved,
      localPaths: scope.paths,
      skippedPaths: [...new Set([...initialScope.excluded, ...scope.excluded])],
      ...(scope.cwd ? { cwd: scope.cwd } : {})
    }
  }

  private async run(
    args: string[],
    separator: number,
    prepared: PreparedSearch,
    consume: (record: Buffer) => boolean | Promise<boolean>
  ): Promise<{
    truncated: boolean
    reason: string | null
  }> {
    if (!prepared.localPaths.length) {
      return { truncated: true, reason: 'remotePathsSkipped' }
    }

    const binary = await this.getBinaryPath('rg')
    const group = `${this.toolkit}_${this.toolName}_${Date.now()}`
    await this.report('bridges.tools.executing_command', {
      binary_name: 'rg', command: JSON.stringify([binary, ...args])
    }, group)

    const started = Date.now()
    const command = localSearchCommand(binary, args, () => RuntimeHelper.getPythonBinPath(), {
      paths: prepared.localPaths, cwd: prepared.cwd
    })
    const outcome = await runRipgrep(command.binary, command.args, SEARCH_TIMEOUT_MS, separator, consume,
      this.executionContext?.signal, command.cwd)
    await this.report('bridges.tools.command_completed', {
      command: 'rg', execution_time: `${Date.now() - started}ms`
    }, group)

    return prepared.skippedPaths.length && !outcome.truncated
      ? { truncated: true, reason: 'remotePathsSkipped' }
      : outcome
  }
}
