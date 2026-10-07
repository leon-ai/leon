import path from 'node:path'

import {
  HeadlessCraftTool,
  RenderFormat,
  RENDER_FORMATS,
  type CraftStep,
  type RenderOptions
} from '../../../src/nodejs/lib/headless-craft-tool'

const PREVIEW_MAX_SIDE = 2_048

/**
 * Edits motion-graphics compositions and renders them with the headless CLI.
 */
export default class EffectCraftTool extends HeadlessCraftTool {
  constructor() {
    super('effectcraft')
  }

  /**
   * Discovers engine commands without loading the application's demo project.
   */
  public async commands(filter = ''): Promise<unknown> {
    const output = await this.runCli(['commands', '--empty', '--json'])

    return {
      commands: this.readCommands(output.stdout, filter),
      diagnostics: output.stderr
    }
  }

  /**
   * Inspects a project's composition and layer tree without modifying it.
   */
  public async inspect(inputPath: string): Promise<unknown> {
    const source = await this.resolveSource(inputPath)
    const output = await this.runCli(['info', '--project', source, '--json'])

    return { project: JSON.parse(output.stdout), diagnostics: output.stderr }
  }

  /**
   * Applies discovered commands to a copied or empty project and saves a new one.
   */
  public async edit(steps: CraftStep[], inputPath?: string): Promise<unknown> {
    this.validateSteps(steps)

    return this.withWorkspace(async (directory) => {
      const args = ['run', '--json']

      if (inputPath === undefined) {
        args.push('--empty')
      } else {
        args.push('--project', await this.stageSource(inputPath, directory))
      }

      for (const step of steps) {
        args.push(step.command, JSON.stringify(step.params ?? {}))
      }

      const project = path.join(directory, 'composition.ecproj')

      args.push('--save-as', project)

      const output = await this.runCli(args)
      const commandResults = JSON.parse(output.stdout)
      const files = await this.publishFiles([
        { path: project, filename: 'composition.ecproj', mimeType: 'application/json' }
      ])

      return { ...files, commandResults, diagnostics: output.stderr }
    })
  }

  /**
   * Renders one composition frame as downloadable PNG and model evidence.
   */
  public async preview(
    inputPath: string,
    timeSeconds = 0,
    comp = ''
  ): Promise<unknown> {
    this.validateTime(timeSeconds)

    const source = await this.resolveSource(inputPath)

    return this.withWorkspace(async (directory) => {
      const target = path.join(directory, 'composition-preview.png')
      const args = [
        'render-frame', '--project', source,
        '--time', String(timeSeconds),
        '--max-side', String(PREVIEW_MAX_SIDE),
        '--out', target, '--json'
      ]

      if (comp) {
        args.push('--comp', comp)
      }

      const output = await this.runCli(args)
      const frame = JSON.parse(output.stdout)
      const files = await this.publishFiles([
        { path: target, filename: 'composition-preview.png', mimeType: 'image/png' }
      ], target)

      return { ...files, frame, diagnostics: output.stderr }
    })
  }

  /**
   * Renders the selected composition into a completed media artifact.
   */
  public async render(
    inputPath: string,
    options: RenderOptions = {},
    comp = ''
  ): Promise<unknown> {
    const renderArgs = this.getRenderArgs(options)
    const format = options.format ?? RenderFormat.Mp4
    const source = await this.resolveSource(inputPath)

    return this.withWorkspace(async (directory) => {
      const filename = `composition.${format}`
      const target = path.join(directory, filename)
      const args = [
        'render', '--project', source, '--out', target,
        ...renderArgs, '--json'
      ]

      if (comp) {
        args.push('--comp', comp)
      }

      const output = await this.runCli(args)
      const result = JSON.parse(output.stdout)
      const files = await this.publishFiles([
        { path: target, filename, mimeType: RENDER_FORMATS[format].mimeType }
      ])

      return { ...files, result, diagnostics: output.stderr }
    })
  }
}
