import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

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
 * Supported document and preview export formats.
 */
export enum VectorFormat {
  Svg = 'svg',
  Pdf = 'pdf',
  Png = 'png'
}

const MAX_MODEL_PREVIEW_BYTES = 8_388_608
const DEFAULT_SETTINGS = { timeout_ms: 120_000 }
const MAX_STEPS = 256
const MIME_TYPES = {
  [VectorFormat.Svg]: 'image/svg+xml',
  [VectorFormat.Pdf]: 'application/pdf',
  [VectorFormat.Png]: 'image/png'
}

/**
 * Creates and edits vector documents with the managed, headless VectorCraft CLI.
 */
export default class VectorCraftTool extends Tool {
  private readonly config = ToolkitConfig.load('media_production', 'vectorcraft')

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
    return 'vectorcraft'
  }

  get toolkit(): string {
    return 'media_production'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Discovers command IDs and their installed parameter documentation.
   */
  public async commands(filter = ''): Promise<unknown> {
    const output = await this.runCli(['commands'])

    return {
      commands: this.readCommands(output.stdout, filter),
      diagnostics: output.stderr
    }
  }

  /**
   * Inspects artboards, object kinds and fonts without changing the source.
   */
  public async inspect(inputPath: string): Promise<unknown> {
    const source = await this.resolveSource(inputPath)
    const output = await this.runCli(['info', source])

    return { document: JSON.parse(output.stdout), diagnostics: output.stderr }
  }

  /**
   * Edits a source copy or a new document and delivers native, SVG and PNG files.
   */
  public async edit(steps: CraftStep[], inputPath?: string): Promise<unknown> {
    this.validateSteps(steps)

    return this.withWorkspace(async (directory) => {
      const args = ['run']

      if (inputPath !== undefined) {
        args.push('--in', await this.stageSource(inputPath, directory))
      }

      for (const step of steps) {
        args.push(
          '--cmd', step.command,
          '--params', JSON.stringify(step.params ?? {})
        )
      }

      const project = path.join(directory, 'artwork.vectorcraft')
      const svg = path.join(directory, 'artwork.svg')
      const png = path.join(directory, 'artwork.png')

      args.push('--export', project)

      // One observed artboard is visual evidence; the native file retains all artboards.
      for (const output of [svg, png]) {
        args.push(
          '--cmd', 'document.export',
          '--params', JSON.stringify({ path: output, artboard: 0 })
        )
      }

      const output = await this.runCli(args)
      const commandResults = this.readJsonLines(output.stdout)
      const files = await this.publishFiles([
        { path: project, filename: 'artwork.vectorcraft', mimeType: 'application/json' },
        { path: svg, filename: 'artwork.svg', mimeType: 'image/svg+xml' },
        { path: png, filename: 'artwork.png', mimeType: 'image/png' }
      ], png)

      return { ...files, commandResults, diagnostics: output.stderr }
    })
  }

  /**
   * Exports a selected document to SVG, PDF or a raster image as an artifact.
   */
  public async export(
    inputPath: string,
    format = VectorFormat.Svg
  ): Promise<unknown> {
    if (!Object.values(VectorFormat).includes(format)) {
      throw new Error('Use svg, pdf or png for VectorCraft export.')
    }

    const source = await this.resolveSource(inputPath)

    return this.withWorkspace(async (directory) => {
      const filename = `artwork.${format}`
      const target = path.join(directory, filename)
      const output = await this.runCli(['convert', source, target])
      const result = JSON.parse(output.stdout)
      const files = await this.publishFiles([
        { path: target, filename, mimeType: MIME_TYPES[format] }
      ], format === VectorFormat.Png ? target : undefined)

      return { ...files, result, diagnostics: output.stderr }
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
