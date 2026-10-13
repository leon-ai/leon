import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const MAX_MODEL_PREVIEW_BYTES = 8_388_608
const DEFAULT_SETTINGS = { timeout_ms: 120_000 }
const MAX_STEPS = 256
const DEFAULT_LONG_EDGE = 2_048

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
 * Photo formats emitted by LightCraft's development pipeline.
 */
export enum PhotoFormat {
  Png = 'png',
  Jpeg = 'jpg',
  Tiff = 'tif',
  Webp = 'webp',
  Avif = 'avif',
  Dng = 'dng'
}

const MIME_TYPES = {
  [PhotoFormat.Png]: 'image/png',
  [PhotoFormat.Jpeg]: 'image/jpeg',
  [PhotoFormat.Tiff]: 'image/tiff',
  [PhotoFormat.Webp]: 'image/webp',
  [PhotoFormat.Avif]: 'image/avif',
  [PhotoFormat.Dng]: 'image/x-adobe-dng'
}

/**
 * Partial development settings and output sizing for a selected photo.
 */
export interface DevelopOptions {
  format?: PhotoFormat
  longEdge?: number
  settings?: Record<string, unknown>
}

/**
 * Develops photos headlessly and operates on explicitly selected photo libraries.
 */
export default class LightCraftTool extends Tool {
  private readonly config = ToolkitConfig.load('media_production', 'lightcraft')

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
    return 'lightcraft'
  }

  get toolkit(): string {
    return 'media_production'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Discovers library and development engine commands.
   */
  public async commands(filter = ''): Promise<unknown> {
    const output = await this.runCli(['commands', '--json'])

    return {
      commands: this.readCommands(output.stdout, filter),
      diagnostics: output.stderr
    }
  }

  /**
   * Discovers development slider identifiers, defaults and accepted ranges.
   */
  public async controls(): Promise<unknown> {
    const output = await this.runCli(['controls', '--json'])

    return { controls: JSON.parse(output.stdout), diagnostics: output.stderr }
  }

  /**
   * Inspects a photo in an ephemeral library without saving beside its original.
   */
  public async inspect(inputPath: string): Promise<unknown> {
    const source = await this.resolveSource(inputPath)
    const output = await this.runCli([
      'run', '--import', source, 'photo.inspect', '{}'
    ])

    return { results: this.readJsonLines(output.stdout), diagnostics: output.stderr }
  }

  /**
   * Develops a source copy and delivers the photo, settings recipe and PNG evidence.
   */
  public async develop(
    inputPath: string,
    controls: Record<string, number> = {},
    options: DevelopOptions = {}
  ): Promise<unknown> {
    const format = options.format ?? PhotoFormat.Png
    const longEdge = options.longEdge ?? DEFAULT_LONG_EDGE

    if (!Object.values(PhotoFormat).includes(format)) {
      throw new Error('Select a supported photo output format.')
    }
    if (!Number.isInteger(longEdge) || longEdge < 0) {
      throw new Error('longEdge must be a non-negative integer; zero preserves full size.')
    }
    if (!controls || typeof controls !== 'object' || Array.isArray(controls)) {
      throw new Error('controls must map observed slider IDs to finite numbers.')
    }
    if (
      options.settings !== undefined &&
      (
        !options.settings ||
        typeof options.settings !== 'object' ||
        Array.isArray(options.settings)
      )
    ) {
      throw new Error('settings must be a partial DevelopSettings JSON object.')
    }

    const controlArgs: string[] = []

    for (const [control, value] of Object.entries(controls)) {
      if (!control || control.includes('=') || !Number.isFinite(value)) {
        throw new Error('controls must map observed slider IDs to finite numbers.')
      }

      controlArgs.push('--set', `${control}=${value}`)
    }

    return this.withWorkspace(async (directory) => {
      const source = await this.stageSource(inputPath, directory)
      const filename = `photo-developed.${format}`
      const target = path.join(directory, filename)
      const settings = path.join(directory, 'settings.json')
      const recipe = path.join(directory, 'photo-develop-settings.json')
      const preview = format === PhotoFormat.Png
        ? target
        : path.join(directory, 'photo-preview.png')

      await fs.writeFile(settings, JSON.stringify(options.settings ?? {}))
      await fs.writeFile(recipe, JSON.stringify({ controls, ...options }, null, 2))

      const args = [
        'render', source, '--settings', settings, ...controlArgs
      ]
      const output = await this.runCli([
        ...args, '-o', target, '--size', String(longEdge)
      ])
      const outputs = [
        { path: target, filename, mimeType: MIME_TYPES[format] },
        {
          path: recipe,
          filename: 'photo-develop-settings.json',
          mimeType: 'application/json'
        }
      ]
      const diagnostics = [output.stderr]

      if (preview !== target) {
        const rendered = await this.runCli([
          ...args, '-o', preview, '--size', String(DEFAULT_LONG_EDGE)
        ])

        diagnostics.push(rendered.stderr)
        outputs.push({
          path: preview,
          filename: 'photo-preview.png',
          mimeType: 'image/png'
        })
      }

      const files = await this.publishFiles(outputs, preview)

      return { ...files, diagnostics: diagnostics.filter(Boolean) }
    })
  }

  /**
   * Runs discovered engine commands in the owner's explicitly selected library.
   */
  public async runLibrary(
    libraryPath: string,
    steps: CraftStep[]
  ): Promise<unknown> {
    this.validateSteps(steps)

    if (!path.isAbsolute(libraryPath) || !(await fs.stat(libraryPath)).isDirectory()) {
      throw new Error('libraryPath must be an absolute existing library directory.')
    }

    // The wrapper always dispatches engine commands, not raw UI/control methods.
    return this.withWorkspace(async (directory) => {
      const script = path.join(directory, 'steps.jsonl')

      const scriptLines = steps.map((step) => JSON.stringify({
        method: 'engine.execute',
        params: { command: step.command, params: step.params ?? {} }
      }))

      await fs.writeFile(script, scriptLines.join('\n'))

      const output = await this.runCli([
        'run', '--library', await fs.realpath(libraryPath), '--script', script
      ])

      return { results: this.readJsonLines(output.stdout), diagnostics: output.stderr }
    })
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
