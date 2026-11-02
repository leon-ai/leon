import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const DEFAULT_SETTINGS = { timeout_ms: 120_000 }
const MAX_STEPS = 256
const MAX_SCALE = 64
const MAX_MODEL_PREVIEW_BYTES = 8_388_608
const NATIVE_MIME_TYPE = 'application/octet-stream'

/**
 * Formats supported by FigCraft's headless exporter.
 */
export enum FigCraftFormat {
  Png = 'png',
  Jpeg = 'jpg',
  Webp = 'webp',
  Svg = 'svg',
  Pdf = 'pdf',
  Fig = 'fig',
  Penpot = 'penpot',
  Xml = 'xml'
}

const MIME_TYPES = {
  [FigCraftFormat.Png]: 'image/png',
  [FigCraftFormat.Jpeg]: 'image/jpeg',
  [FigCraftFormat.Webp]: 'image/webp',
  [FigCraftFormat.Svg]: 'image/svg+xml',
  [FigCraftFormat.Pdf]: 'application/pdf',
  [FigCraftFormat.Fig]: 'application/octet-stream',
  [FigCraftFormat.Penpot]: 'application/zip',
  [FigCraftFormat.Xml]: 'application/xml'
}
const PREVIEW_FORMATS = new Set([
  FigCraftFormat.Png,
  FigCraftFormat.Jpeg,
  FigCraftFormat.Webp
])

/**
 * An engine command; named results can be referenced by subsequent steps.
 */
export interface FigCraftStep {
  command: string
  params?: Record<string, unknown>
  as?: string
}

/**
 * Layer inspection options using the engine's native field projection.
 */
export interface InspectOptions {
  nodeId?: number
  fields?: string[]
  outline?: boolean
}

/**
 * A page or layer selection shared by previews and exports.
 */
export interface ExportOptions {
  page?: string
  node?: string
  scale?: number
}

/**
 * A completed file ready for conversation artifact storage.
 */
interface OutputFile {
  path: string
  mimeType: string
}

/**
 * Creates interface designs and prototypes with the managed headless FigCraft CLI.
 */
export default class FigCraftTool extends Tool {
  private readonly config = ToolkitConfig.load('media_production', 'figcraft')

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
    return 'figcraft'
  }

  get toolkit(): string {
    return 'media_production'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Discovers command IDs and parameter documentation from the installed engine.
   */
  public async commands(filter = ''): Promise<unknown> {
    const args = ['commands', '--json']

    if (filter) {
      args.push(`--filter=${filter}`)
    }

    const output = await this.runCli(args)

    return { commands: JSON.parse(output.stdout), diagnostics: output.stderr }
  }

  /**
   * Reads document metadata or a layer and its immediate children without saving.
   */
  public async inspect(
    inputPath: string,
    options: InspectOptions = {}
  ): Promise<unknown> {
    const source = await this.resolveSource(inputPath)

    if (options.nodeId === undefined) {
      if (options.fields !== undefined || options.outline !== undefined) {
        throw new Error('Provide nodeId when selecting layer fields or outline.')
      }

      const output = await this.runCli(['info', source, '--json'])

      return { document: JSON.parse(output.stdout), diagnostics: output.stderr }
    }

    if (!Number.isSafeInteger(options.nodeId) || options.nodeId < 0) {
      throw new Error('nodeId must be a non-negative layer ID observed through inspect.')
    }
    if (options.outline && options.fields !== undefined) {
      throw new Error('Use either outline or fields for layer inspection.')
    }

    return this.withWorkspace(async (directory) => {
      const output = await this.runScript(directory, [{
        command: 'node.get',
        params: {
          id: options.nodeId,
          ...(options.fields !== undefined ? { fields: options.fields } : {}),
          ...(options.outline !== undefined ? { outline: options.outline } : {})
        }
      }], source)

      return {
        node: output.results[0]?.result,
        diagnostics: output.stderr
      }
    })
  }

  /**
   * Edits a disposable source copy or new document and publishes a native file and preview.
   */
  public async edit(
    steps: FigCraftStep[],
    inputPath?: string,
    preview: ExportOptions = {}
  ): Promise<unknown> {
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) {
      throw new Error(`Provide between 1 and ${MAX_STEPS} FigCraft commands.`)
    }

    for (const step of steps) {
      if (!step || typeof step.command !== 'string' || !step.command.trim()) {
        throw new Error('Each step requires a command ID discovered through commands.')
      }
      if (step.params !== undefined && (
        !step.params || typeof step.params !== 'object' || Array.isArray(step.params)
      )) {
        throw new Error('Command params must be a JSON object.')
      }
      if (step.as !== undefined && (typeof step.as !== 'string' || !step.as.trim())) {
        throw new Error('A named step requires a non-empty as value.')
      }
    }

    this.validateExportOptions(preview)
    this.requireSession()
    const source = inputPath === undefined ? undefined : await this.resolveSource(inputPath)

    return this.withWorkspace(async (directory) => {
      const diagnostics = []
      let staged: string | undefined

      if (source) {
        staged = path.join(directory, 'source.figcraft')

        // Native copies retain history; imports resolve images beside their original source.
        if (path.extname(source).toLowerCase() === '.figcraft') {
          await fs.copyFile(source, staged, fs.constants.COPYFILE_EXCL)
        } else {
          const converted = await this.runCli(['convert', source, staged])

          diagnostics.push(converted.stderr)
        }
      }

      const project = path.join(directory, 'design.figcraft')
      const image = path.join(directory, 'preview.png')
      const edited = await this.runScript(directory, steps, staged, project)
      const rendered = await this.exportFile(project, image, FigCraftFormat.Png, preview)
      const files = await this.publishFiles([
        { path: project, mimeType: NATIVE_MIME_TYPE },
        { path: image, mimeType: MIME_TYPES[FigCraftFormat.Png] }
      ], image, MIME_TYPES[FigCraftFormat.Png])

      return {
        ...files,
        commandResults: edited.results,
        diagnostics: [...diagnostics, edited.stderr, rendered.stderr].filter(Boolean).join('\n')
      }
    })
  }

  /**
   * Exports a page or layer into a downloadable artifact, attaching raster evidence when bounded.
   */
  public async export(
    inputPath: string,
    format = FigCraftFormat.Png,
    options: ExportOptions = {}
  ): Promise<unknown> {
    if (!Object.values(FigCraftFormat).includes(format)) {
      throw new Error(`Use a supported FigCraft export format: ${Object.values(FigCraftFormat).join(', ')}.`)
    }

    this.validateExportOptions(options)
    this.requireSession()
    const source = await this.resolveSource(inputPath)

    return this.withWorkspace(async (directory) => {
      const target = path.join(directory, `design.${format}`)
      const output = await this.exportFile(source, target, format, options)
      const files = await this.publishFiles(
        [{ path: target, mimeType: MIME_TYPES[format] }],
        PREVIEW_FORMATS.has(format) ? target : undefined,
        MIME_TYPES[format]
      )

      return { ...files, diagnostics: output.stderr }
    })
  }

  /**
   * Uses SDK binary management and streaming so host cancellation and deadlines remain authoritative.
   */
  private async runCli(args: string[]): Promise<{ stdout: string, stderr: string }> {
    this.executionContext?.signal?.throwIfAborted()
    const timeout = this.settings['timeout_ms']

    if (typeof timeout !== 'number' || !Number.isSafeInteger(timeout) || timeout < 1) {
      throw new Error('timeout_ms must be a positive integer.')
    }

    let stdout = ''
    let stderr = ''

    await this.executeCommand({
      binaryName: 'figcraft-cli',
      args,
      options: { timeout },
      onOutput: (chunk, isError) => {
        if (isError) {
          stderr += chunk
        } else {
          stdout += chunk
        }
      }
    })
    this.executionContext?.signal?.throwIfAborted()

    return { stdout, stderr }
  }

  /**
   * Lets the engine validate commands and resolve step references in one atomic script.
   */
  private async runScript(
    directory: string,
    steps: FigCraftStep[],
    source?: string,
    target?: string
  ): Promise<{ results: { result: unknown }[], stderr: string }> {
    const script = path.join(directory, 'commands.json')

    await fs.writeFile(script, JSON.stringify(steps))
    const args = ['run', script]

    if (source) {
      args.push('--in', source)
    }
    if (target) {
      args.push('--out', target)
    }

    const output = await this.runCli(args)
    const results = output.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))

    return { results, stderr: output.stderr }
  }

  /**
   * Writes one selected page or layer to a tool-owned output path.
   */
  private async exportFile(
    source: string,
    target: string,
    format: FigCraftFormat,
    options: ExportOptions
  ): Promise<{ stdout: string, stderr: string }> {
    const args = ['export', source, '-o', target, '--format', format]

    for (const [name, value] of Object.entries(options)) {
      if (value !== undefined) {
        args.push(`--${name}=${value}`)
      }
    }

    return this.runCli(args)
  }

  /**
   * Checks shared selectors before any design commands execute.
   */
  private validateExportOptions(options: ExportOptions): void {
    if (options.scale !== undefined && (
      !Number.isFinite(options.scale) || options.scale <= 0 || options.scale > MAX_SCALE
    )) {
      throw new Error(`scale must be positive and no greater than ${MAX_SCALE}.`)
    }

    for (const name of ['page', 'node'] as const) {
      const value = options[name]

      if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
        throw new Error(`${name} must be an observed, non-empty name or ID.`)
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
   * Fails before generating output that cannot be delivered to its owning conversation.
   */
  private requireSession(): void {
    if (!this.executionContext?.conversationSessionId) {
      throw new Error('Artifact output requires a conversation session.')
    }
  }

  /**
   * Keeps intermediate scripts and designs out of owner projects and removes them on failure.
   */
  private async withWorkspace<T>(operation: (directory: string) => Promise<T>): Promise<T> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-figcraft-'))

    try {
      return await operation(directory)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }

  /**
   * Validates completed files before publishing and attaches a size-bounded visual preview.
   */
  private async publishFiles(
    outputs: OutputFile[],
    previewPath: string | undefined,
    previewMimeType: string
  ): Promise<{
    artifacts: Awaited<ReturnType<Tool['createArtifact']>>[]
    modelPreviewAttached: boolean
  }> {
    for (const output of outputs) {
      const stat = await fs.stat(output.path)

      if (!stat.isFile() || stat.size === 0) {
        throw new Error('FigCraft did not produce a non-empty output file.')
      }
    }

    this.executionContext?.signal?.throwIfAborted()
    const artifacts = []

    for (const output of outputs) {
      artifacts.push(await this.createArtifact(output.path, output.mimeType))
    }

    const preview = previewPath ? await fs.stat(previewPath) : undefined
    const modelPreviewAttached = Boolean(preview && preview.size <= MAX_MODEL_PREVIEW_BYTES)

    if (previewPath && modelPreviewAttached) {
      await this.attachModelFile(previewPath, previewMimeType)
    }

    return { artifacts, modelPreviewAttached }
  }
}
