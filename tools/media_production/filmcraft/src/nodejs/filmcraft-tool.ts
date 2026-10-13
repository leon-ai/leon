import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const MAX_MODEL_PREVIEW_BYTES = 8_388_608
const DEFAULT_SETTINGS = { timeout_ms: 120_000 }
const MAX_STEPS = 256
const PREVIEW_SCALE = 0.5

/**
 * A completed file to publish into conversation artifact storage.
 */
interface OutputFile {
  path: string
  filename: string
  mimeType: string
}

/**
 * An engine command with parameters discovered from the installed registry.
 */
export interface CraftStep {
  command: string
  params?: Record<string, unknown>
}

/**
 * Delivery formats supported by headless timeline rendering.
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
 * Edits timeline projects and renders their active sequence with the headless CLI.
 */
export default class FilmCraftTool extends Tool {
  private readonly config = ToolkitConfig.load('media_production', 'filmcraft')

  constructor() {
    super()

    this.settings = ToolkitConfig.loadToolSettings(
      this.toolkit,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    return 'filmcraft'
  }

  get toolkit(): string {
    return 'media_production'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Discovers commands and their installed parameter documentation.
   */
  public async commands(filter = ''): Promise<unknown> {
    const output = await this.runCli([
      'commands', '--json', ...this.getProfileArgs()
    ])

    return {
      commands: this.readCommands(output.stdout, filter),
      diagnostics: output.stderr
    }
  }

  /**
   * Inspects the project tree and active sequence without saving changes.
   */
  public async inspect(inputPath: string): Promise<unknown> {
    const source = await this.resolveSource(inputPath)
    const output = await this.runCli([
      'inspect', '--project', source, '--compact', ...this.getProfileArgs()
    ])

    return { project: JSON.parse(output.stdout), diagnostics: output.stderr }
  }

  /**
   * Runs a JSON-lines command script on a copied or new project and saves a copy.
   */
  public async edit(steps: CraftStep[], inputPath?: string): Promise<unknown> {
    this.validateSteps(steps)

    return this.withWorkspace(async (directory) => {
      const script = path.join(directory, 'steps.jsonl')
      const project = path.join(directory, 'timeline.fcproj')
      const args = [
        'run', script, '--save-as', project, ...this.getProfileArgs()
      ]

      if (inputPath !== undefined) {
        args.push('--project', await this.stageSource(inputPath, directory))
      }

      const scriptLines = steps.map((step) => JSON.stringify({
        id: step.command,
        params: step.params ?? {}
      }))

      await fs.writeFile(script, scriptLines.join('\n'))

      const output = await this.runCli(args)
      const commandResults = this.readJsonLines(output.stdout)
      const files = await this.publishFiles([
        { path: project, filename: 'timeline.fcproj', mimeType: 'application/json' }
      ])

      return { ...files, commandResults, diagnostics: output.stderr }
    })
  }

  /**
   * Renders a selected timeline position as PNG and model evidence.
   */
  public async preview(inputPath: string, timeSeconds = 0): Promise<unknown> {
    this.validateTime(timeSeconds)

    const source = await this.resolveSource(inputPath)

    return this.withWorkspace(async (directory) => {
      const target = path.join(directory, 'timeline-preview.png')
      const output = await this.runCli([
        'render', '--project', source,
        '--seconds', String(timeSeconds), '--scale', String(PREVIEW_SCALE),
        '--out', target, ...this.getProfileArgs()
      ])
      const files = await this.publishFiles([
        { path: target, filename: 'timeline-preview.png', mimeType: 'image/png' }
      ], target)

      return { ...files, timeSeconds, diagnostics: output.stderr }
    })
  }

  /**
   * Waits for sequence export to complete before attaching the media artifact.
   */
  public async render(
    inputPath: string,
    options: RenderOptions = {}
  ): Promise<unknown> {
    const renderArgs = this.getRenderArgs(options)
    const format = options.format ?? RenderFormat.Mp4
    const source = await this.resolveSource(inputPath)

    return this.withWorkspace(async (directory) => {
      const filename = `timeline.${format}`
      const target = path.join(directory, filename)
      const output = await this.runCli([
        'export', target, '--project', source, ...renderArgs,
        '--compact', ...this.getProfileArgs()
      ])
      const result = JSON.parse(output.stdout)
      const files = await this.publishFiles([
        { path: target, filename, mimeType: RENDER_FORMATS[format].mimeType }
      ])

      return { ...files, result, diagnostics: output.stderr }
    })
  }

  /**
   * Keeps export presets in Leon's owning profile rather than the GUI's global store.
   */
  private getProfileArgs(): string[] {
    return ['--data-dir', path.join(path.dirname(this.getSettingsPath()), 'data')]
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

  /**
   * Resolves an owner-selected regular file before invoking the app.
   */
  private async resolveSource(inputPath: string): Promise<string> {
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
  private async stageSource(
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
  private async withWorkspace<T>(
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
   * Validates every output before publishing, and attaches bounded preview evidence.
   */
  private async publishFiles(
    outputs: OutputFile[],
    previewPath?: string,
    previewMimeType = 'image/png'
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

    const preview = previewPath ? await fs.stat(previewPath) : null
    const modelPreviewAttached = Boolean(
      preview?.isFile() && preview.size > 0 && preview.size <= MAX_MODEL_PREVIEW_BYTES
    )

    if (previewPath && modelPreviewAttached) {
      await this.attachModelFile(previewPath, previewMimeType)
    }

    return { artifacts, modelPreviewAttached }
  }
}
