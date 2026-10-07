import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const DEFAULT_SETTINGS = { timeout_ms: 120_000 }
const MAX_STEPS = 256
const MAX_MODEL_IMAGE_BYTES = 8_388_608

/**
 * An engine command with parameters discovered from the installed registry.
 */
export interface CraftStep {
  command: string
  params?: Record<string, unknown>
}

/**
 * A completed file to copy into conversation artifact storage.
 */
export interface CraftOutput {
  path: string
  filename: string
  mimeType: string
}

/**
 * Delivery formats supported by both composition and timeline renderers.
 */
export enum RenderFormat {
  Mp4 = 'mp4',
  Gif = 'gif',
  Wav = 'wav'
}

/**
 * A rendered project's format and optional range in seconds.
 */
export interface RenderOptions {
  format?: RenderFormat
  startSeconds?: number
  endSeconds?: number
}

export const RENDER_FORMATS = {
  [RenderFormat.Mp4]: { cliFormat: 'h264', mimeType: 'video/mp4' },
  [RenderFormat.Gif]: { cliFormat: 'gif', mimeType: 'image/gif' },
  [RenderFormat.Wav]: { cliFormat: 'wav', mimeType: 'audio/wav' }
}

/**
 * Shared CLI and artifact plumbing for this toolkit's headless Craft adapters.
 * Application commands and argument layouts remain in the individual tools.
 */
export abstract class HeadlessCraftTool extends Tool {
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor(private readonly craftName: string) {
    super()

    this.config = ToolkitConfig.load(this.toolkit, craftName)
    this.settings = ToolkitConfig.loadToolSettings(
      this.toolkit,
      craftName,
      DEFAULT_SETTINGS
    )
    this.checkRequiredSettings(craftName)
  }

  get toolName(): string {
    return this.craftName
  }

  get toolkit(): string {
    return 'media_production'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Runs the managed CLI through the SDK downloader.
   */
  protected async runCli(args: string[]): Promise<{
    stdout: string
    stderr: string
  }> {
    const timeout = this.settings['timeout_ms']

    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1) {
      throw new Error('timeout_ms must be a positive integer.')
    }

    let stdout = ''
    let stderr = ''

    await this.executeCommand({
      binaryName: `${this.toolName}-cli`,
      args,
      options: { timeout },
      onOutput: (text, isError) => {
        if (isError) {
          stderr += text
        } else {
          stdout += text
        }
      }
    })

    return { stdout, stderr }
  }

  /**
   * Filters the actual registry rather than maintaining command keywords here.
   */
  protected readCommands(stdout: string, filter: string): unknown[] {
    const commands: unknown = JSON.parse(stdout)

    if (!Array.isArray(commands)) {
      throw new Error('The CLI did not return a command registry.')
    }

    return commands.filter((command) =>
      JSON.stringify(command).toLowerCase().includes(filter.toLowerCase())
    )
  }

  /**
   * Parses bounded command sequences before their files are published.
   */
  protected readJsonLines(stdout: string): unknown[] {
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }

  /**
   * Checks the common sequence shape; the app validates command-specific params.
   */
  protected validateSteps(steps: CraftStep[]): void {
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) {
      throw new Error(`Provide between 1 and ${MAX_STEPS} engine commands.`)
    }

    for (const step of steps) {
      if (!step || typeof step.command !== 'string' || !step.command.trim()) {
        throw new Error('Each step requires an observed command ID.')
      }
      if (
        step.params !== undefined &&
        (!step.params || typeof step.params !== 'object' || Array.isArray(step.params))
      ) {
        throw new Error('Command params must be a JSON object.')
      }
    }
  }

  /**
   * Resolves an owner-selected regular file before invoking the app.
   */
  protected async resolveSource(inputPath: string): Promise<string> {
    if (!path.isAbsolute(inputPath)) {
      throw new Error('inputPath must be an absolute local file path.')
    }

    const source = await fs.realpath(inputPath)

    if (!(await fs.stat(source)).isFile()) {
      throw new Error('inputPath must be a regular file.')
    }

    return source
  }

  /**
   * Keeps implicit Save commands confined to a disposable source copy.
   */
  protected async stageSource(
    inputPath: string,
    directory: string
  ): Promise<string> {
    const source = await this.resolveSource(inputPath)
    const staged = path.join(directory, `source${path.extname(source)}`)

    await fs.copyFile(source, staged, fs.constants.COPYFILE_EXCL)

    return staged
  }

  /**
   * Keeps intermediates out of owner projects and removes them after any failure.
   */
  protected async withWorkspace<T>(
    operation: (directory: string) => Promise<T>
  ): Promise<T> {
    if (!this.executionContext?.conversationSessionId) {
      throw new Error('Artifact output requires a conversation session.')
    }

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `leon-${this.toolName}-`))

    try {
      return await operation(directory)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }

  /**
   * Validates every output before publishing, and attaches bounded PNG evidence.
   */
  protected async publishFiles(
    outputs: CraftOutput[],
    previewPath?: string
  ): Promise<{
    artifacts: Awaited<ReturnType<Tool['createArtifact']>>[]
    modelPreviewAttached: boolean
  }> {
    for (const output of outputs) {
      const stat = await fs.stat(output.path)

      if (!stat.isFile() || stat.size === 0) {
        throw new Error(`${this.toolName} did not produce a non-empty output file.`)
      }
    }

    const artifacts = []

    for (const output of outputs) {
      const artifact = await this.createArtifact(
        output.path,
        output.mimeType,
        output.filename
      )

      artifacts.push(artifact)
    }

    const modelPreviewAttached = Boolean(
      previewPath && (await fs.stat(previewPath)).size <= MAX_MODEL_IMAGE_BYTES
    )

    if (previewPath && modelPreviewAttached) {
      await this.attachModelFile(previewPath, 'image/png')
    }

    return { artifacts, modelPreviewAttached }
  }

  /**
   * Validates the shared render range before converting it to CLI flags.
   */
  protected getRenderArgs(options: RenderOptions): string[] {
    const format = options.format ?? RenderFormat.Mp4

    if (!Object.values(RenderFormat).includes(format)) {
      throw new Error('Use mp4, gif or wav for rendered output.')
    }

    const args = ['--format', RENDER_FORMATS[format].cliFormat]

    for (const [flag, seconds] of [
      ['--start', options.startSeconds],
      ['--end', options.endSeconds]
    ] as const) {
      if (seconds !== undefined) {
        this.validateTime(seconds)
        args.push(flag, String(seconds))
      }
    }
    if (
      options.endSeconds !== undefined &&
      options.endSeconds <= (options.startSeconds ?? 0)
    ) {
      throw new Error('endSeconds must be greater than startSeconds.')
    }

    return args
  }

  /**
   * Rejects invalid timeline positions before starting a renderer.
   */
  protected validateTime(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error('Time must be a finite non-negative number of seconds.')
    }
  }
}
