import fs from 'node:fs/promises'
import path from 'node:path'

import {
  HeadlessCraftTool,
  type CraftStep
} from '../../../src/nodejs/lib/headless-craft-tool'

const DEFAULT_LONG_EDGE = 2_048

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
export default class LightCraftTool extends HeadlessCraftTool {
  constructor() {
    super('lightcraft')
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
}
