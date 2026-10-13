import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const run = promisify(execFile)
const TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 1_024 * 1_024
const MAX_PATHS = 5
const MAX_ENTRIES = 100
const MAX_DEPTH = 12
const THREADS = 2
const BYTE_SUFFIX = 'B'

interface DustNode {
  size: string
  name: string
  children: DustNode[]
}

interface InspectOptions {
  depth?: number
  entries?: number
  apparentSize?: boolean
}

interface UsageNode {
  path: string
  sizeBytes: number
  children: UsageNode[]
}

/**
 * Convert dust's byte display strings into numeric values for agent projections.
 */
function usageTree(node: DustNode): UsageNode {
  const sizeBytes = node.size.endsWith(BYTE_SUFFIX)
    ? Number(node.size.slice(0, -BYTE_SUFFIX.length))
    : NaN
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error('Dust returned an invalid byte count.')
  }

  return {
    path: node.name, sizeBytes,
    children: node.children.map(usageTree)
  }
}

/**
 * Rank disk usage without inheriting interactive dust configuration.
 */
export default class DustTool extends Tool {
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)

  get toolName(): string {
    return 'dust'
  }

  get toolkit(): string {
    return 'system_utilities'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Bound the displayed tree while keeping filesystem usage and warnings visible.
   */
  public async inspect(paths: string[], options: InspectOptions = {}): Promise<Record<string, unknown>> {
    if (!Array.isArray(paths) || !paths.length || paths.length > MAX_PATHS) {
      throw new Error(`Select between 1 and ${MAX_PATHS} absolute paths.`)
    }

    const depth = options.depth ?? 3
    const entries = options.entries ?? 30
    if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH ||
        !Number.isInteger(entries) || entries < 1 || entries > MAX_ENTRIES) {
      throw new Error('Invalid depth or entries limit.')
    }
    for (const target of paths) {
      if (typeof target !== 'string' || !path.isAbsolute(target)) {
        throw new Error('Each path must be absolute.')
      }
      await fs.lstat(target)
    }

    const binary = await this.getBinaryPath('dust')
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-dust-'))
    try {
      // An explicit empty config prevents owner shell preferences from changing
      // machine-readable output or enabling recursive symlink traversal.
      const configPath = path.join(temporary, 'dust.toml')
      await fs.writeFile(configPath, '')
      const args = ['--config', configPath, '--output-json', '--output-format', 'b',
        '--no-progress', '--no-colors', '--full-paths', '--limit-filesystem',
        '--print-errors', '--threads', String(THREADS), '--depth', String(depth),
        '--number-of-lines', String(entries)]
      if (options.apparentSize) {
        args.push('--apparent-size')
      }
      args.push('--', ...paths)
      await this.report('bridges.tools.executing_command', {
        binary_name: 'dust', command: JSON.stringify([binary, ...args])
      })
      const { stdout, stderr } = await run(binary, args, {
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        killSignal: 'SIGKILL',
        windowsHide: true,
        ...(this.executionContext?.signal ? { signal: this.executionContext.signal } : {})
      })
      const tree = usageTree(JSON.parse(stdout) as DustNode)

      return {
        paths, tree, sizeUnits: 'bytes',
        sizeMode: options.apparentSize ? 'apparent' : 'allocated',
        preview: { depth, entries },
        warnings: stderr.trim() || null,
        scanComplete: !stderr.trim(),
        coverage: 'Ranked, depth-limited preview; omitted entries remain included in directory totals.'
      }
    } finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }
}
