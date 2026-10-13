import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { RuntimeHelper } from '@/helpers/runtime-helper'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const MAX_MODEL_PREVIEW_BYTES = 8_388_608
const CLI_PATH = fileURLToPath(new URL('./lib/cli.mjs', import.meta.url))
const TEMPLATE_PATH = fileURLToPath(new URL('./lib/template/', import.meta.url))
const require = createRequire(import.meta.url)
const DEFAULT_SETTINGS = { timeout_ms: 600_000, workers: 2 }
const MAX_WORKERS = 8
const MAX_PREVIEW_FRAMES = 8
const CANVAS_SIZES = {
  portrait: { width: 1_080, height: 1_920 },
  landscape: { width: 1_920, height: 1_080 },
  square: { width: 1_080, height: 1_080 }
}

/**
 * Repair passes can validate source or selected times; delivery needs full coverage.
 */
export enum CheckMode {
  Lint = 'lint',
  Targeted = 'targeted',
  Full = 'full'
}

/**
 * Selected timestamps are only valid for a targeted repair check.
 */
export interface CheckOptions {
  mode?: CheckMode
  times?: number[]
}

/**
 * A completed file to publish into conversation artifact storage.
 */
interface OutputFile {
  path: string
  filename: string
  mimeType: string
}

/**
 * Canvas presets supported by the composition scaffolder.
 */
export enum Resolution {
  Portrait = 'portrait',
  Landscape = 'landscape',
  Square = 'square'
}

/**
 * Encoding quality for iteration and finished social videos.
 */
export enum Quality {
  Draft = 'draft',
  Looks = 'looks',
  Delivery = 'delivery'
}

/**
 * Authors and verifies HTML motion graphics using the tool-owned local renderer.
 */
export default class HyperframesTool extends Tool {
  private readonly config = ToolkitConfig.load('media_production', 'hyperframes')

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
    return 'hyperframes'
  }

  get toolkit(): string {
    return 'media_production'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Finds reusable scenes and effects before the agent authors custom motion.
   */
  public async catalog(query: string): Promise<unknown> {
    if (!query.trim()) {
      throw new Error('Provide a description of the scene or effect to find.')
    }

    const output = await this.runCli(['catalog', '--query', query, '--json'])

    return { catalog: JSON.parse(output.stdout), diagnostics: output.stderr }
  }

  /**
   * Scaffolds a new project and supplies local GSAP for offline animation.
   */
  public async create(
    projectPath: string,
    resolution: Resolution = Resolution.Portrait
  ): Promise<unknown> {
    this.validateProjectPath(projectPath)

    if (!Object.values(Resolution).includes(resolution)) {
      throw new Error('Use portrait, landscape or square for the canvas preset.')
    }

    // Claim a new directory before scaffolding so existing owner files cannot
    // be overwritten by an upstream template or a retried creation call.
    await fs.mkdir(path.dirname(projectPath), { recursive: true })
    await fs.mkdir(projectPath)

    const output = await this.runCli([
      'init', projectPath, '--resolution', resolution, '--non-interactive'
    ], projectPath)
    const assets = path.join(projectPath, 'assets')
    const gsapPath = path.join(assets, 'gsap.min.js')

    await fs.mkdir(assets, { recursive: true })
    await fs.copyFile(require.resolve('gsap/dist/gsap.min.js'), gsapPath)

    const canvas = CANVAS_SIZES[resolution]

    await fs.cp(TEMPLATE_PATH, projectPath, { recursive: true })

    const templateFiles = [
      'index.html',
      'compositions/understand.html',
      'compositions/verify.html'
    ]

    for (const filename of templateFiles) {
      const destination = path.join(projectPath, filename)
      const template = await fs.readFile(destination, 'utf8')

      await fs.writeFile(
        destination,
        template
          .replaceAll('__WIDTH__', String(canvas.width))
          .replaceAll('__HEIGHT__', String(canvas.height))
      )
    }

    return {
      projectPath,
      entryPath: path.join(projectPath, 'index.html'),
      gsapPath,
      scenePaths: ['understand.html', 'verify.html'].map((filename) =>
        path.join(projectPath, 'compositions', filename)
      ),
      diagnostics: output.stderr
    }
  }

  /**
   * Installs a discovered catalog item into the selected working project.
   */
  public async add(projectPath: string, item: string): Promise<unknown> {
    const project = await this.resolveProject(projectPath)

    if (!item.trim() || item.startsWith('-')) {
      throw new Error('Provide an item name observed in the catalog.')
    }

    const output = await this.runCli([
      'add', item, '--dir', project, '--no-clipboard', '--json'
    ], project)

    return { installed: JSON.parse(output.stdout), diagnostics: output.stderr }
  }

  /**
   * Inspects tracks, source files and absolute scene timing without editing.
   */
  public async inspect(projectPath: string): Promise<unknown> {
    const project = await this.resolveProject(projectPath)
    const output = await this.runCli(['timeline', '--json'], project)

    return { timeline: JSON.parse(output.stdout), diagnostics: output.stderr }
  }

  /**
   * Returns actionable lint, runtime, layout and contrast findings before export.
   */
  public async check(
    projectPath: string,
    options: CheckOptions = {}
  ): Promise<unknown> {
    const mode = options.mode ?? CheckMode.Full

    if (!Object.values(CheckMode).includes(mode)) {
      throw new Error('Use lint, targeted or full for the check mode.')
    }

    if (mode === CheckMode.Targeted) {
      if (
        !Array.isArray(options.times) ||
        options.times.length < 1 || options.times.length > MAX_PREVIEW_FRAMES
      ) {
        throw new Error(`Targeted checks require between 1 and ${MAX_PREVIEW_FRAMES} timestamps.`)
      }

      for (const seconds of options.times) {
        this.validateTime(seconds)
      }
    } else if (options.times !== undefined) {
      throw new Error('Timestamp selection is only supported by targeted checks.')
    }

    const project = await this.resolveProject(projectPath)

    // Repair passes preserve strict findings without sampling every transition.
    // Their successful results still cannot establish complete delivery coverage.
    const args = mode === CheckMode.Lint
      ? ['lint', '--json']
      : [
          'check', '--json', '--strict',
          ...(mode === CheckMode.Full
            ? ['--at-transitions']
            : ['--at', options.times!.join(',')])
        ]
    const output = await this.runCli(args, project)
    const report = JSON.parse(output.stdout)
    const checks = mode === CheckMode.Lint
      ? {
          ok: report.ok && report.warningCount === 0,
          strict: true,
          browserSkipped: true,
          lint: report
        }
      : report

    // The CLI can drop out-of-range selections; a repair pass must not silently
    // claim success for timestamps it never inspected.
    if (
      mode === CheckMode.Targeted &&
      typeof checks.layout?.duration === 'number' &&
      options.times!.some((time) => time > checks.layout.duration)
    ) {
      throw new Error(`Selected timestamps must be within the ${checks.layout.duration}-second composition.`)
    }

    return {
      scope: mode,
      complete: mode === CheckMode.Full &&
        !checks.browserSkipped && Boolean(checks.layout?.samples?.length),
      checks,
      durationMs: output.durationMs,
      diagnostics: output.stderr
    }
  }

  /**
   * Attaches exact-time PNG previews for visual and transition review.
   */
  public async preview(projectPath: string, times: number[]): Promise<unknown> {
    if (
      !Array.isArray(times) ||
      times.length < 1 ||
      times.length > MAX_PREVIEW_FRAMES
    ) {
      throw new Error(`Provide between 1 and ${MAX_PREVIEW_FRAMES} preview times.`)
    }

    for (const seconds of times) {
      this.validateTime(seconds)
    }

    const project = await this.resolveProject(projectPath)

    return this.withWorkspace(async (directory) => {
      const output = await this.runCli([
        'snapshot', '--output', directory, '--at', times.join(','),
        '--no-end', '--describe', 'false'
      ], project)
      const filenames = (await fs.readdir(directory))
        .filter((filename) => path.extname(filename) === '.png')
        .sort()

      if (filenames.length !== times.length) {
        throw new Error('The renderer did not produce every requested preview.')
      }

      const contactSheet = path.join(directory, 'contact-sheet.jpg')
      const evidence = await fs.stat(contactSheet).catch(() => null)
      // A contact sheet bounds model evidence while full-resolution frames
      // remain available as downloadable artifacts for closer inspection.
      const files = await this.publishFiles(filenames.map((filename) => ({
        path: path.join(directory, filename),
        filename,
        mimeType: 'image/png'
      })), evidence?.isFile() ? contactSheet : undefined, 'image/jpeg')

      return { ...files, times, durationMs: output.durationMs, diagnostics: output.stderr }
    })
  }

  /**
   * Renders a completed MP4 and publishes it through conversation artifacts.
   */
  public async render(
    projectPath: string,
    quality: Quality = Quality.Delivery
  ): Promise<unknown> {
    if (!Object.values(Quality).includes(quality)) {
      throw new Error('Use draft, looks or delivery for render quality.')
    }

    const workers = this.settings['workers']

    if (
      typeof workers !== 'number' ||
      !Number.isInteger(workers) ||
      workers < 1 ||
      workers > MAX_WORKERS
    ) {
      throw new Error(`workers must be an integer from 1 to ${MAX_WORKERS}.`)
    }

    const project = await this.resolveProject(projectPath)

    return this.withWorkspace(async (directory) => {
      const target = path.join(directory, 'composition.mp4')
      const output = await this.runCli([
        'render', '--output', target, '--quality', quality,
        '--workers', String(workers)
      ], project)
      const files = await this.publishFiles([
        { path: target, filename: 'composition.mp4', mimeType: 'video/mp4' }
      ])

      return { ...files, durationMs: output.durationMs, renderSummary: output.stdout, diagnostics: output.stderr }
    })
  }

  /**
   * Runs the pinned CLI under Leon's managed Node.js with SDK progress and timeout.
   */
  private async runCli(args: string[], cwd?: string): Promise<{
    stdout: string
    stderr: string
    durationMs: number
  }> {
    const timeout = this.settings['timeout_ms']

    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1) {
      throw new Error('timeout_ms must be a positive integer.')
    }

    let stdout = ''
    let stderr = ''
    const startedAt = performance.now()

    try {
      await this.executeCommand({
        binaryName: RuntimeHelper.getNodeBinPath(),
        args: [CLI_PATH, ...args],
        skipBinaryDownload: true,
        options: { timeout, ...(cwd ? { cwd } : {}) },
        onOutput: (text, isError) => {
          if (isError) {
            stderr += text
          } else {
            stdout += text
          }
        }
      })
    } catch (error) {
      // Validation failures are useful observations, not a reason to lose the
      // structured findings. Launch failures and other commands still fail.
      if (
        !['check', 'lint'].includes(args[0]!) ||
        (error as { status?: number }).status !== 1 ||
        !stdout.trim() ||
        (JSON.parse(stdout) as { ok?: boolean }).ok !== false
      ) {
        throw error
      }
    }

    return { stdout, stderr, durationMs: Math.round(performance.now() - startedAt) }
  }

  private validateProjectPath(projectPath: string): void {
    if (!path.isAbsolute(projectPath)) {
      throw new Error('projectPath must be an absolute local directory path.')
    }
  }

  private async resolveProject(projectPath: string): Promise<string> {
    this.validateProjectPath(projectPath)

    const project = await fs.realpath(projectPath)

    if (!(await fs.stat(project)).isDirectory()) {
      throw new Error('projectPath must be a directory containing index.html.')
    }

    await this.resolveSource(path.join(project, 'index.html'))

    return project
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
