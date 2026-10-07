import path from 'node:path'

import {
  HeadlessCraftTool,
  type CraftStep
} from '../../../src/nodejs/lib/headless-craft-tool'

/**
 * Supported document and preview export formats.
 */
export enum VectorFormat {
  Svg = 'svg',
  Pdf = 'pdf',
  Png = 'png'
}

const MIME_TYPES = {
  [VectorFormat.Svg]: 'image/svg+xml',
  [VectorFormat.Pdf]: 'application/pdf',
  [VectorFormat.Png]: 'image/png'
}

/**
 * Creates and edits vector documents with the managed, headless VectorCraft CLI.
 */
export default class VectorCraftTool extends HeadlessCraftTool {
  constructor() {
    super('vectorcraft')
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
}
