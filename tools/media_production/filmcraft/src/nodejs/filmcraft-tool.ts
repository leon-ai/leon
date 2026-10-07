import fs from 'node:fs/promises'
import path from 'node:path'

import {
  HeadlessCraftTool,
  RenderFormat,
  RENDER_FORMATS,
  type CraftStep,
  type RenderOptions
} from '../../../src/nodejs/lib/headless-craft-tool'

const PREVIEW_SCALE = 0.5

/**
 * Edits timeline projects and renders their active sequence with the headless CLI.
 */
export default class FilmCraftTool extends HeadlessCraftTool {
  constructor() {
    super('filmcraft')
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
}
