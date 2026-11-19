import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { terminateProcessTree } from '@sdk/utils/process'
import { CODEBASE_PATH, PROFILE_TOOLS_PATH } from '@bridge/constants'

const require = createRequire(import.meta.url)
const DEFAULT_SETTINGS = { embedding: 'local/potion-code-16m-v2' }
const MAX_SOURCES = 24
const MAX_RESULTS = 20
const DEFAULT_RESULTS = 6
const MAX_OUTPUT_BYTES = 2 * 1_024 * 1_024
const MAX_SOURCE_PREVIEW = 24_000
const OUTPUT_CHUNK_CHARACTERS = 4_000

interface SourceResult {
  path: string
  content?: string
  truncated?: boolean
  error?: string
}

/**
 * Retrieves source-backed evidence from persistent local folder indexes.
 * The native process owns scan rules, change detection and embedding storage.
 */
export default class ZvecGrepTool extends Tool {
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)

  public constructor() {
    super()
    this.settings = ToolkitConfig.loadToolSettings(this.toolkit, this.toolName, DEFAULT_SETTINGS)
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    return 'zvec_grep'
  }

  get toolkit(): string {
    return 'file_system'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Refreshes changed files before retrieval; all sessions reuse folder indexes.
   * Results remain separate per source because their ranks are local to an index.
   */
  public async search(query: string, paths: string[] = [CODEBASE_PATH], limit = DEFAULT_RESULTS): Promise<{
    sources: SourceResult[]
    coverage: string
  }> {
    if (!query.trim() || !Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS
      || !paths.length || paths.length > MAX_SOURCES) {
      throw new Error('Provide a query, between 1 and 24 folders, and a result limit between 1 and 20.')
    }
    const embedding = String(this.settings['embedding'] ?? DEFAULT_SETTINGS.embedding)
    if (!embedding.startsWith('local/')) {
      throw new Error('Workspace search requires a local embedding model.')
    }
    const sources: SourceResult[] = []
    const seen = new Set<string>()
    for (const source of paths) {
      this.executionContext?.signal?.throwIfAborted()
      try {
        const root = await fs.realpath(source)
        if (seen.has(root)) {
          continue
        }
        if (!(await fs.stat(root)).isDirectory()) {
          throw new Error('This resource is not a folder.')
        }
        seen.add(root)
        // A normal index operation reconciles additions, edits and deletions.
        // Never request a destructive rebuild of an existing owner's index.
        await this.run(['--index', '--embedding', embedding], root, false)
        const content = await this.run(['--hybrid', query, '--limit', String(limit), '--preview', 'short', '--refresh', 'off'], root, true)
        sources.push({ path: root, content: content.slice(0, MAX_SOURCE_PREVIEW), truncated: content.length > MAX_SOURCE_PREVIEW })
      } catch (error) {
        this.executionContext?.signal?.throwIfAborted()
        sources.push({ path: source, error: error instanceof Error ? error.message : String(error) })
      }
    }

    return { sources, coverage: 'Ranked passages per folder, not exhaustive coverage. Read the cited current files before modifying them or making exact claims.' }
  }

  /**
   * Streams native progress while bounding retained process output. Host task
   * cancellation owns the lifetime; no independent idle timers are introduced.
   */
  private async run(args: string[], cwd: string, capture: boolean): Promise<string> {
    const signal = this.executionContext?.signal
    signal?.throwIfAborted()
    const executable = path.join(path.dirname(require.resolve('@zvec/zvec-grep/package.json')), 'bin', 'zg.exe')
    const home = path.join(PROFILE_TOOLS_PATH, this.toolkit, this.toolName, 'runtime')
    const child = spawn(executable, [...args, '--mode', 'direct', '--home', home], {
      cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let bytes = 0
    let failure: Error | undefined
    const stop = (): void => {
      if (child.pid) {
        void terminateProcessTree(child.pid, 'SIGKILL').catch(() => undefined)
      }
    }
    const context = this.executionContext
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
    const consume = (data: Buffer, isError: boolean): void => {
      bytes += data.byteLength
      if (bytes > MAX_OUTPUT_BYTES) {
        failure = new Error('Workspace search exceeded the retained output limit.')
        stop()
        return
      }
      const text = (isError ? decoders.stderr : decoders.stdout).write(data)
      if (isError) {
        stderr = (stderr + text).slice(-MAX_SOURCE_PREVIEW)
      } else if (capture) {
        stdout += text
      }
      if (!capture || isError) {
        for (let offset = 0; offset < text.length; offset += OUTPUT_CHUNK_CHARACTERS) {
          this.emitOutput(text.slice(offset, offset + OUTPUT_CHUNK_CHARACTERS), undefined, context)
        }
      }
    }
    child.stdout.on('data', (data: Buffer) => consume(data, false))
    child.stderr.on('data', (data: Buffer) => consume(data, true))
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) {
      stop()
    }

    try {
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code) => {
          if (failure) {
            reject(failure)
          } else if (code !== 0) {
            reject(new Error(`Workspace search exited with code ${code}: ${stderr}`))
          } else {
            resolve()
          }
        })
      })
      signal?.throwIfAborted()

      return stdout + decoders.stdout.end()
    } finally {
      signal?.removeEventListener('abort', stop)
    }
  }
}
