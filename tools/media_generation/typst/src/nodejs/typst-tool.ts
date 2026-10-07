import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const DEFAULT_SETTINGS = { timeout_ms: 120_000 }
const MAX_DIAGNOSTIC_CHARS = 4_000
const MAX_FONT_LIST_CHARS = 40_000
const DEFAULT_PPI = 144

/**
 * Supported artifact formats for local Typst compilation.
 */
export enum TypstFormat {
  Pdf = 'pdf',
  Svg = 'svg',
  Png = 'png'
}

const MIME_TYPES: Record<TypstFormat, string> = {
  [TypstFormat.Pdf]: 'application/pdf',
  [TypstFormat.Svg]: 'image/svg+xml',
  [TypstFormat.Png]: 'image/png'
}

/**
 * Project inputs and export options understood by the Typst CLI.
 */
export interface CompileOptions {
  format?: TypstFormat
  rootPath?: string
  fontPaths?: string[]
  inputs?: Record<string, string>
  pages?: string
  ppi?: number
}

/**
 * Compiles owner-selected Typst projects using Leon's managed binary facilities.
 */
export default class TypstTool extends Tool {
  private readonly config = ToolkitConfig.load('media_generation', 'typst')

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
    return 'typst'
  }

  get toolkit(): string {
    return 'media_generation'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Compiles a local source and publishes every exported page as an artifact.
   */
  public async compile(
    sourcePath: string,
    options: CompileOptions = {}
  ): Promise<unknown> {
    if (!this.executionContext?.conversationSessionId) {
      throw new Error('Compilation requires a conversation session.')
    }

    const format = options.format ?? TypstFormat.Pdf
    const ppi = options.ppi ?? DEFAULT_PPI

    if (!Object.values(TypstFormat).includes(format)) {
      throw new Error('Use PDF, SVG or PNG for Typst output.')
    }
    if (!Number.isInteger(ppi) || ppi < 1) {
      throw new Error('ppi must be a positive integer.')
    }
    if (!path.isAbsolute(sourcePath)) {
      throw new Error('sourcePath must be an absolute local file path.')
    }

    const source = await fs.realpath(sourcePath)

    if (!(await fs.stat(source)).isFile()) {
      throw new Error('sourcePath must be a regular file.')
    }

    const root = await this.resolveDirectory(
      options.rootPath ?? path.dirname(source)
    )
    const relative = path.relative(root, source)

    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error('sourcePath must be inside rootPath.')
    }

    const args = [
      'compile',
      '--root', root,
      '--format', format,
      '--diagnostic-format', 'short',
      ...await this.getFontArgs(options.fontPaths)
    ]

    for (const [key, value] of Object.entries(options.inputs ?? {})) {
      if (!key || key.includes('=') || typeof value !== 'string') {
        throw new Error('inputs must contain non-empty keys without = and string values.')
      }

      args.push('--input', `${key}=${value}`)
    }
    if (options.pages !== undefined) {
      args.push('--pages', options.pages)
    }
    if (format === TypstFormat.Png) {
      args.push('--ppi', String(ppi))
    }

    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-typst-'))

    try {
      // The page placeholder preserves all pages for SVG/PNG exports; a fixed
      // basename avoids interpreting braces in the owner's source filename.
      const outputName = format === TypstFormat.Pdf
        ? `document.${format}`
        : `page-{0p}.${format}`
      const diagnostics = await this.executeCommand({
        binaryName: 'typst',
        args: [...args, '--', source, path.join(temporary, outputName)],
        options: { cwd: root, timeout: this.getTimeout() }
      })
      const files = (await fs.readdir(temporary)).sort()

      if (files.length === 0) {
        throw new Error('Typst produced no output. Check the selected pages.')
      }

      const artifacts = []
      const basename = path.parse(sourcePath).name

      for (const file of files) {
        artifacts.push(await this.createArtifact(
          path.join(temporary, file),
          MIME_TYPES[format],
          format === TypstFormat.Pdf
            ? `${basename}.${format}`
            : `${basename}-${file}`
        ))
      }

      return {
        sourcePath: source,
        format,
        pages: options.pages ?? 'all',
        artifacts,
        diagnostics: diagnostics.slice(0, MAX_DIAGNOSTIC_CHARS),
        diagnosticsTruncated: diagnostics.length > MAX_DIAGNOSTIC_CHARS
      }
    } finally {
      // Artifacts already live in conversation storage; only intermediates
      // are removed, including after failed compilation.
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }

  /**
   * Lists locally available font families before choosing document typography.
   */
  public async listFonts(fontPaths: string[] = []): Promise<unknown> {
    const output = await this.executeCommand({
      binaryName: 'typst',
      args: ['fonts', ...await this.getFontArgs(fontPaths)],
      options: { timeout: this.getTimeout() }
    })

    return {
      text: output.slice(0, MAX_FONT_LIST_CHARS),
      totalChars: output.length,
      truncated: output.length > MAX_FONT_LIST_CHARS
    }
  }

  /**
   * Resolves project/font directories before passing them to the compiler.
   */
  private async resolveDirectory(directory: string): Promise<string> {
    if (!path.isAbsolute(directory)) {
      throw new Error('Project and font directories must be absolute local paths.')
    }

    const resolved = await fs.realpath(directory)

    if (!(await fs.stat(resolved)).isDirectory()) {
      throw new Error('Project and font paths must be directories.')
    }

    return resolved
  }

  /**
   * Adds validated font directories without replacing the CLI's default fonts.
   */
  private async getFontArgs(fontPaths: string[] = []): Promise<string[]> {
    const args: string[] = []

    for (const directory of fontPaths) {
      args.push('--font-path', await this.resolveDirectory(directory))
    }

    return args
  }

  /**
   * Uses profile-owned execution limits for both compilation and font discovery.
   */
  private getTimeout(): number {
    const timeout = this.settings['timeout_ms']

    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1) {
      throw new Error('Typst timeout_ms must be a positive integer.')
    }

    return timeout
  }
}
