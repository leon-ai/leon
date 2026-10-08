import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { RuntimeHelper } from '@/helpers/runtime-helper'

import { Tool } from '@sdk/base-tool'
import { createZipArchive } from '@sdk/utils/archive'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { ToolRuntimeLifetime } from '@bridge/tool-runtime-types'

import { PresentationSessions, PresentationView } from './lib/presentation-sessions'

const CLI_PATH = fileURLToPath(new URL('./lib/cli.mjs', import.meta.url))
const TEMPLATE_PATH = fileURLToPath(new URL('./lib/template/', import.meta.url))
const MANIFEST_PATH = fileURLToPath(new URL('./package.json', import.meta.url))
const SOURCE_EXCLUSIONS = new Set(['node_modules', 'dist'])
const DEFAULT_SETTINGS = { timeout_ms: 600_000 }
const MAX_PREVIEW_STATES = 6
const MAX_PREVIEW_BYTES = 8_388_608
const MAX_WAIT_MS = 10_000
const MAX_DIAGNOSTIC_CHARACTERS = 20_000
const MIME_TYPES: Record<string, string> = {
  '.zip': 'application/zip',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

/**
 * Browser presentations preserve animation; Office and image exports are static.
 */
export enum PresentationFormat {
  Web = 'web',
  Pdf = 'pdf',
  Png = 'png',
  Pptx = 'pptx',
  EditablePptx = 'pptx-editable'
}

/**
 * A specific slide and click step, optionally captured during its content animation.
 */
export interface PreviewState {
  slide: number
  click?: number
  waitMs?: number
}

/**
 * Selected slides cover repair work; omitting selection checks the entire deck.
 */
export interface CheckOptions {
  slides?: number[]
}

/**
 * Export options for delivery and printable click-step handouts.
 */
export interface ExportOptions {
  format?: PresentationFormat
  withClicks?: boolean
  includeNotes?: boolean
  includeSource?: boolean
}

/**
 * Open a live deck in the execution host's browser, or return its local links.
 */
export interface PresentOptions {
  view?: PresentationView
  openBrowser?: boolean
}

/**
 * Authors and verifies animated presentations with tool-owned local dependencies.
 */
export default class SlidevTool extends Tool {
  public readonly runtimeLifetime = ToolRuntimeLifetime.Persistent
  private readonly config = ToolkitConfig.load('document', 'slidev')
  private readonly presentations = new PresentationSessions()

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
    return 'slidev'
  }

  get toolkit(): string {
    return 'document'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Claims a new project and supplies styled layouts, local icons and editable source.
   */
  public async create(projectPath: string, title: string): Promise<unknown> {
    this.validateProjectPath(projectPath)

    if (!title.trim()) {
      throw new Error('Provide a non-empty presentation title.')
    }

    await fs.mkdir(path.dirname(projectPath), { recursive: true })
    await fs.mkdir(projectPath)

    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as {
      dependencies: Record<string, string>
    }
    const dependencies = { ...manifest.dependencies }

    const template = await fs.readFile(path.join(TEMPLATE_PATH, 'slides.md'), 'utf8')
    const entryPath = path.join(projectPath, 'slides.md')

    await fs.mkdir(path.join(projectPath, 'public'))
    await fs.writeFile(entryPath, template.replace('__TITLE__', JSON.stringify(title)))
    await fs.copyFile(
      path.join(TEMPLATE_PATH, 'style.css'),
      path.join(projectPath, 'style.css')
    )
    await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify({
      name: 'leon-presentation',
      private: true,
      type: 'module',
      scripts: { dev: 'slidev --open', build: 'slidev build', export: 'slidev export' },
      dependencies
    }, null, 2) + '\n')

    return {
      projectPath,
      entryPath,
      assetsPath: path.join(projectPath, 'public'),
      layouts: ['cover', 'section', 'default', 'two-cols'],
      iconCollection: 'lucide'
    }
  }

  /**
   * Returns parsed slide content, notes and layouts without changing the project.
   */
  public async inspect(projectPath: string): Promise<unknown> {
    const entry = await this.resolveEntry(projectPath)

    return this.withWorkspace(async (directory) => this.runCli('inspect', entry, directory))
  }

  /**
   * Visits every slide and click step, reporting runtime and visible layout defects.
   */
  public async check(
    projectPath: string,
    options: CheckOptions = {}
  ): Promise<unknown> {
    if (
      options.slides !== undefined && (
        !Array.isArray(options.slides) || options.slides.length < 1 ||
        options.slides.length > MAX_PREVIEW_STATES ||
        options.slides.some((slide) => !Number.isSafeInteger(slide) || slide < 1)
      )
    ) {
      throw new Error(`Select between 1 and ${MAX_PREVIEW_STATES} positive slide numbers.`)
    }

    const entry = await this.resolveEntry(projectPath)

    return this.withWorkspace(async (directory) => this.runCli('check', entry, directory, {
      slides: options.slides
    }))
  }

  /**
   * Publishes selected click states and bounded images for visual model inspection.
   */
  public async preview(projectPath: string, states: PreviewState[]): Promise<unknown> {
    this.requireSession()

    if (!Array.isArray(states) || states.length < 1 || states.length > MAX_PREVIEW_STATES) {
      throw new Error(`Provide between 1 and ${MAX_PREVIEW_STATES} preview states.`)
    }

    for (const state of states) {
      if (
        !Number.isSafeInteger(state.slide) || state.slide < 1 ||
        !Number.isSafeInteger(state.click ?? 0) || (state.click ?? 0) < 0 ||
        !Number.isSafeInteger(state.waitMs ?? 0) || (state.waitMs ?? 0) < 0 ||
        (state.waitMs ?? 0) > MAX_WAIT_MS
      ) {
        throw new Error(`Use positive slide numbers, non-negative clicks and waitMs from 0 to ${MAX_WAIT_MS}.`)
      }
    }

    const entry = await this.resolveEntry(projectPath)

    return this.withWorkspace(async (directory) => {
      const result = await this.runCli('preview', entry, directory, { states })
      const captured = result['states'] as Array<{ filename: string }>
      const artifacts = await this.publishFiles(directory, captured.map((state) => state.filename))
      let previewBytes = 0
      let modelPreviewCount = 0

      for (const state of captured) {
        const filename = path.join(directory, state.filename)
        const size = (await fs.stat(filename)).size

        if (previewBytes + size <= MAX_PREVIEW_BYTES) {
          await this.attachModelFile(filename, 'image/png')
          previewBytes += size
          modelPreviewCount += 1
        }
      }

      return { ...result, artifacts, modelPreviewCount }
    })
  }

  /**
   * Opens a live, editable deck and retains its server until stopped or shutdown.
   */
  public async present(projectPath: string, options: PresentOptions = {}): Promise<unknown> {
    const owner = this.requireSession()
    const view = options.view ?? PresentationView.Audience

    if (!Object.values(PresentationView).includes(view)) {
      throw new Error('Use audience or presenter for the presentation view.')
    }

    const entry = await this.resolveEntry(projectPath)

    return this.presentations.present(
      owner,
      entry,
      view,
      options.openBrowser ?? true,
      this.executionContext?.signal
    )
  }

  /**
   * Releases the presentation owned by this conversation and closes its server.
   */
  public async stop(sessionId: string): Promise<unknown> {
    return this.presentations.stop(this.requireSession(), sessionId)
  }

  /**
   * Releases live decks when the worker or its host shuts down.
   */
  public async dispose(): Promise<void> {
    await this.presentations.dispose()
  }

  /**
   * Delivers requested downloads, optionally including editable project sources.
   */
  public async export(projectPath: string, options: ExportOptions = {}): Promise<unknown> {
    this.requireSession()

    const format = options.format ?? PresentationFormat.Web

    if (!Object.values(PresentationFormat).includes(format)) {
      throw new Error('Use web, pdf, png, pptx or pptx-editable for export format.')
    }

    const entry = await this.resolveEntry(projectPath)

    return this.withWorkspace(async (directory) => {
      const result = await this.runCli('export', entry, directory, {
        format,
        withClicks: options.withClicks ?? false,
        includeNotes: options.includeNotes ?? false
      })
      const files = result['files'] as string[]

      if (format === PresentationFormat.Web) {
        await createZipArchive(
          path.join(directory, 'web'),
          path.join(directory, files[0]!)
        )
      }

      if (options.includeSource) {
        const filename = 'presentation-source.zip'

        await createZipArchive(path.dirname(entry), path.join(directory, filename), {
          exclude: (relative) => relative.split('/').some((part) =>
            part.startsWith('.') || SOURCE_EXCLUSIONS.has(part)
          )
        })
        files.push(filename)
      }

      const artifacts = await this.publishFiles(directory, files)

      return { ...result, format, artifacts }
    })
  }

  /**
   * Uses SDK cancellation, progress and timeout under Leon's managed Node.js.
   */
  private async runCli(
    action: string,
    entry: string,
    directory: string,
    parameters: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    const timeout = this.settings['timeout_ms']

    if (typeof timeout !== 'number' || !Number.isSafeInteger(timeout) || timeout < 1) {
      throw new Error('timeout_ms must be a positive integer.')
    }

    const resultPath = path.join(directory, 'result.json')
    let diagnostics = ''
    const startedAt = performance.now()

    await this.executeCommand({
      binaryName: RuntimeHelper.getNodeBinPath(),
      args: [CLI_PATH, action, entry, directory, resultPath, JSON.stringify(parameters)],
      skipBinaryDownload: true,
      options: { timeout, cwd: path.dirname(entry) },
      onOutput: (text, isError) => {
        if (isError) {
          diagnostics = (diagnostics + text).slice(-MAX_DIAGNOSTIC_CHARACTERS)
        }
      }
    })

    const result = JSON.parse(await fs.readFile(resultPath, 'utf8')) as Record<string, unknown>

    return { ...result, durationMs: Math.round(performance.now() - startedAt), diagnostics }
  }

  private validateProjectPath(projectPath: string): void {
    if (!path.isAbsolute(projectPath)) {
      throw new Error('projectPath must be an absolute local directory.')
    }
  }

  private async resolveEntry(projectPath: string): Promise<string> {
    this.validateProjectPath(projectPath)

    const entry = await fs.realpath(path.join(projectPath, 'slides.md'))

    if (!(await fs.stat(entry)).isFile()) {
      throw new Error('The project must contain a regular slides.md file.')
    }

    return entry
  }

  private requireSession(): string {
    const session = this.executionContext?.conversationSessionId

    if (!session) {
      throw new Error('Presentation sessions and artifacts require a conversation session.')
    }

    return session
  }

  /**
   * Keeps generated files outside the editable project and cleans up on failure.
   */
  private async withWorkspace<T>(operation: (directory: string) => Promise<T>): Promise<T> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-slidev-'))

    try {
      return await operation(directory)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }

  /**
   * Verifies the complete output batch before publishing durable profile artifacts.
   */
  private async publishFiles(
    directory: string,
    filenames: string[]
  ): Promise<Awaited<ReturnType<Tool['createArtifact']>>[]> {
    if (filenames.length === 0) {
      throw new Error('Slidev did not produce any output files.')
    }

    for (const filename of filenames) {
      const stat = await fs.stat(path.join(directory, filename))

      if (!stat.isFile() || stat.size === 0 || !MIME_TYPES[path.extname(filename)]) {
        throw new Error('Slidev did not produce a complete supported output batch.')
      }
    }

    const artifacts = []

    for (const filename of filenames) {
      artifacts.push(await this.createArtifact(
        path.join(directory, filename),
        MIME_TYPES[path.extname(filename)]!,
        filename
      ))
    }

    return artifacts
  }
}
