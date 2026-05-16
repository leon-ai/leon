import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const DEFAULT_MAX_CHARS = 80_000
const MAX_CHARS = 250_000
const BINARY_SAMPLE_BYTES = 8_192

interface ReadOptions {
  head?: number
  tail?: number
  maxChars?: number
  offsetChars?: number
}

interface WriteOptions {
  overwrite?: boolean
  createParents?: boolean
}

interface AppendOptions {
  createParents?: boolean
}

export default class FileTool extends Tool {
  private static readonly TOOLKIT = 'operating_system_control'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    this.config = ToolkitConfig.load(FileTool.TOOLKIT, this.toolName)
  }

  get toolName(): string {
    return 'file'
  }

  get toolkit(): string {
    return FileTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  public async read(
    targetPath: string,
    options: ReadOptions = {}
  ): Promise<{
    success: boolean
    data?: {
      path: string
      content: string
      size: number
      returnedChars: number
      totalChars: number
      truncated: boolean
      offsetChars: number
      nextOffsetChars: number | null
    }
    error?: string
  }> {
    const resolvedPath = this.resolvePath(targetPath)
    const readable = await this.assertReadableTextFile(resolvedPath)

    if (!readable.success) {
      return readable
    }

    if (options.head !== undefined && options.tail !== undefined) {
      return {
        success: false,
        error: 'Use either head or tail, not both.'
      }
    }

    const content = await fs.promises.readFile(resolvedPath, 'utf8')
    const totalChars = content.length
    let selectedContent = content
    let offsetChars = this.clampNumber(options.offsetChars, 0, totalChars, 0)

    if (options.head !== undefined) {
      selectedContent = content
        .split('\n')
        .slice(0, this.clampNumber(options.head, 0, Number.MAX_SAFE_INTEGER, 0))
        .join('\n')
      offsetChars = 0
    } else if (options.tail !== undefined) {
      selectedContent = content
        .split('\n')
        .slice(-this.clampNumber(options.tail, 0, Number.MAX_SAFE_INTEGER, 0))
        .join('\n')
      offsetChars = Math.max(0, totalChars - selectedContent.length)
    } else {
      selectedContent = content.slice(offsetChars)
    }

    const maxChars = this.clampNumber(options.maxChars, 1, MAX_CHARS, DEFAULT_MAX_CHARS)
    const returnedContent = selectedContent.slice(0, maxChars)
    const nextOffsetChars = offsetChars + returnedContent.length
    const truncated =
      returnedContent.length < selectedContent.length || nextOffsetChars < totalChars

    return {
      success: true,
      data: {
        path: resolvedPath,
        content: returnedContent,
        size: readable.size || 0,
        returnedChars: returnedContent.length,
        totalChars,
        truncated,
        offsetChars,
        nextOffsetChars: truncated ? nextOffsetChars : null
      }
    }
  }

  public async readToolArtifact(
    outputLogPath: string,
    options: Pick<ReadOptions, 'maxChars' | 'offsetChars'> = {}
  ): Promise<{
    success: boolean
    data?: {
      path: string
      content: string
      size: number
      returnedChars: number
      totalChars: number
      truncated: boolean
      offsetChars: number
      nextOffsetChars: number | null
    }
    error?: string
  }> {
    return this.read(outputLogPath, {
      maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
      offsetChars: options.offsetChars
    })
  }

  public async write(
    targetPath: string,
    content: string,
    options: WriteOptions = {}
  ): Promise<{
    success: boolean
    data?: { path: string, bytesWritten: number }
    error?: string
  }> {
    const resolvedPath = this.resolvePath(targetPath)

    if (fs.existsSync(resolvedPath) && options.overwrite !== true) {
      return {
        success: false,
        error: 'File already exists. Set overwrite=true to replace it.'
      }
    }

    if (options.createParents) {
      await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true })
    }

    await fs.promises.writeFile(resolvedPath, content, 'utf8')

    return {
      success: true,
      data: {
        path: resolvedPath,
        bytesWritten: Buffer.byteLength(content, 'utf8')
      }
    }
  }

  public async append(
    targetPath: string,
    content: string,
    options: AppendOptions = {}
  ): Promise<{
    success: boolean
    data?: { path: string, bytesWritten: number }
    error?: string
  }> {
    const resolvedPath = this.resolvePath(targetPath)

    if (options.createParents) {
      await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true })
    }

    await fs.promises.appendFile(resolvedPath, content, 'utf8')

    return {
      success: true,
      data: {
        path: resolvedPath,
        bytesWritten: Buffer.byteLength(content, 'utf8')
      }
    }
  }

  private resolvePath(inputPath: string): string {
    const trimmedPath = String(inputPath || '').trim()

    if (trimmedPath === '~') {
      return os.homedir()
    }

    if (trimmedPath.startsWith('~/') || trimmedPath.startsWith('~\\')) {
      return path.resolve(os.homedir(), trimmedPath.slice(2))
    }

    return path.resolve(trimmedPath)
  }

  private async assertReadableTextFile(targetPath: string): Promise<{
    success: false
    error: string
    size?: never
  } | {
    success: true
    size: number
  }> {
    const stat = await this.safeLstat(targetPath)

    if (!stat) {
      return {
        success: false,
        error: `File not found: ${targetPath}`
      }
    }

    if (!stat.isFile()) {
      return {
        success: false,
        error: `Path is not a file: ${targetPath}`
      }
    }

    if (await this.isLikelyBinary(targetPath)) {
      return {
        success: false,
        error: `Refusing to read likely binary file: ${targetPath}`
      }
    }

    return {
      success: true,
      size: stat.size
    }
  }

  private async isLikelyBinary(targetPath: string): Promise<boolean> {
    const fileHandle = await fs.promises.open(targetPath, 'r')
    try {
      const buffer = Buffer.alloc(BINARY_SAMPLE_BYTES)
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0)
      const sample = buffer.subarray(0, bytesRead)

      if (sample.includes(0)) {
        return true
      }

      let suspiciousControlChars = 0
      for (const byte of sample) {
        if (byte < 7 || (byte > 13 && byte < 32)) {
          suspiciousControlChars += 1
        }
      }

      return bytesRead > 0 && suspiciousControlChars / bytesRead > 0.1
    } finally {
      await fileHandle.close()
    }
  }

  private clampNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number
  ): number {
    const numericValue = Number(value)

    if (!Number.isFinite(numericValue)) {
      return fallback
    }

    return Math.min(Math.max(Math.floor(numericValue), min), max)
  }

  private async safeLstat(targetPath: string): Promise<fs.Stats | null> {
    try {
      return await fs.promises.lstat(targetPath)
    } catch {
      return null
    }
  }

}
