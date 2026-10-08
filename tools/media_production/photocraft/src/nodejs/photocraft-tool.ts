import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

import { requestControl } from './lib/control-client'

const DEFAULT_SETTINGS = {
  control_port: 7878,
  control_token_file: '',
  timeout_ms: 120_000
}
const CLI_BINARY_NAME = 'photocraft-cli'
const MAX_STEPS = 256
const MAX_MODEL_IMAGE_BYTES = 8_388_608
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * An engine operation using parameters discovered from PhotoCraft's registry.
 */
export interface PhotoCraftStep {
  command: string
  params?: Record<string, unknown>
}

/**
 * Drives the managed PhotoCraft CLI and its authenticated local desktop API.
 */
export default class PhotoCraftTool extends Tool {
  private readonly config = ToolkitConfig.load('media_production', 'photocraft')

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
    return 'photocraft'
  }

  get toolkit(): string {
    return 'media_production'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Returns the installed registry, optionally with active desktop enablement.
   */
  public async commands(filter = '', desktop = false): Promise<unknown> {
    if (desktop) {
      const commands = await this.control('engine.commands')

      if (!filter || !Array.isArray(commands)) {
        return commands
      }

      return commands.filter((command) =>
        JSON.stringify(command).toLowerCase().includes(filter.toLowerCase())
      )
    }

    const args = ['commands', '--json']

    if (filter) {
      args.push('--filter', filter)
    }

    const output = await this.runCli(args)

    return { commands: JSON.parse(output.stdout), diagnostics: output.stderr }
  }

  /**
   * Inspects a selected file or the active desktop document without editing it.
   */
  public async inspect(inputPath?: string): Promise<unknown> {
    if (inputPath === undefined) {
      return this.control('engine.execute', {
        command: 'document.inspect',
        params: {}
      })
    }

    const source = await this.resolveSource(inputPath)
    const output = await this.runCli(['info', source, '--compact'])

    return { document: JSON.parse(output.stdout), diagnostics: output.stderr }
  }

  /**
   * Stages a source copy, executes edits, and publishes layered and rendered output.
   */
  public async edit(inputPath: string, steps: PhotoCraftStep[]): Promise<unknown> {
    this.requireSession()

    if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) {
      throw new Error(`Provide between 1 and ${MAX_STEPS} PhotoCraft steps.`)
    }

    for (const step of steps) {
      if (!step || typeof step.command !== 'string' || !step.command.trim()) {
        throw new Error('Each step requires an observed command ID.')
      }
      this.validateParams(step.params ?? {})
    }

    const source = await this.resolveSource(inputPath)
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-photocraft-'))

    try {
      // Even Save commands without a path can only write back to this staged file.
      const staged = path.join(directory, `source${path.extname(source)}`)
      const project = path.join(directory, 'edited.pcraft')
      const image = path.join(directory, 'edited.png')

      await fs.copyFile(source, staged, fs.constants.COPYFILE_EXCL)

      const args = ['run', staged]

      for (const step of steps) {
        args.push(
          '--cmd', step.command,
          '--params', JSON.stringify(step.params ?? {})
        )
      }

      args.push('--out', project)

      const edited = await this.runCli(args)
      const converted = await this.runCli(['convert', project, image])
      const document = await this.runCli(['info', project, '--compact'])

      // Validate CLI evidence before publishing files or attaching a preview.
      const documentInfo = JSON.parse(document.stdout)
      const commandResults = edited.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      const stem = path.basename(source, path.extname(source))
      const artifacts = [
        await this.publishFile(
          project,
          'application/octet-stream',
          `${stem}-edited.pcraft`
        ),
        await this.publishFile(image, 'image/png', `${stem}-edited.png`)
      ]
      const modelPreviewAttached = await this.attachPreview(image)

      return {
        artifacts,
        modelPreviewAttached,
        document: documentInfo,
        commandResults,
        diagnostics: [edited.stderr, converted.stderr, document.stderr].filter(Boolean)
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }

  /**
   * Publishes a file composite or a screenshot without leaking base64 in results.
   */
  public async preview(inputPath?: string): Promise<unknown> {
    this.requireSession()
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-photocraft-'))

    try {
      const image = path.join(directory, 'preview.png')
      let diagnostics = ''

      if (inputPath !== undefined) {
        const source = await this.resolveSource(inputPath)
        const output = await this.runCli(['convert', source, image])

        diagnostics = output.stderr
      } else {
        const screenshot = await this.requestDesktop('ui.screenshot', {}) as {
          base64?: unknown
        }

        if (typeof screenshot?.base64 !== 'string') {
          throw new Error('PhotoCraft did not return a screenshot.')
        }

        const bytes = Buffer.from(screenshot.base64, 'base64')

        if (
          bytes.length > MAX_MODEL_IMAGE_BYTES ||
          !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
        ) {
          throw new Error('PhotoCraft returned an invalid or oversized PNG screenshot.')
        }

        await fs.writeFile(image, bytes, { flag: 'wx' })
      }

      const artifact = await this.publishFile(image, 'image/png', 'photocraft-preview.png')
      const modelPreviewAttached = await this.attachPreview(image)

      return { artifacts: [artifact], modelPreviewAttached, diagnostics }
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  }

  /**
   * Exposes documented desktop methods while keeping authentication private.
   */
  public async control(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    this.validateParams(params)

    if (typeof method !== 'string' || !method.trim() || method === 'auth') {
      throw new Error('Provide a documented PhotoCraft method other than auth.')
    }
    if (method === 'ui.screenshot') {
      throw new Error('Use preview to capture and attach the desktop screenshot.')
    }
    if (
      method === 'app.save' &&
      (typeof params['path'] !== 'string' || !params['path'])
    ) {
      throw new Error('app.save requires an explicit new output path; implicit source overwrite is refused.')
    }

    return this.requestDesktop(method, params)
  }

  private async requestDesktop(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const port = this.settings['control_port']
    const tokenPath = this.settings['control_token_file']

    if (
      typeof port !== 'number' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535
    ) {
      throw new Error('PhotoCraft control_port must be an integer between 1 and 65535.')
    }
    if (typeof tokenPath !== 'string' || !path.isAbsolute(tokenPath)) {
      throw new Error('Configure an absolute private control_token_file in PhotoCraft profile settings.')
    }

    const stat = await fs.lstat(tokenPath)

    if (!stat.isFile() || stat.size > 128) {
      throw new Error('PhotoCraft control_token_file must be a small regular file, not a link.')
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw new Error('PhotoCraft token file must be private to its owner (mode 0600).')
    }

    const token = (await fs.readFile(tokenPath, 'utf8')).trim()

    if (!/^[\da-f]{64}$/i.test(token)) {
      throw new Error('PhotoCraft token file must contain a 64-character hexadecimal token.')
    }

    return requestControl(port, token, method, params, this.getTimeout())
  }

  private async runCli(args: string[]): Promise<{ stdout: string, stderr: string }> {
    let stdout = ''
    let stderr = ''

    await this.executeCommand({
      binaryName: CLI_BINARY_NAME,
      args,
      options: { timeout: this.getTimeout() },
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

  private getTimeout(): number {
    const timeout = this.settings['timeout_ms']

    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1) {
      throw new Error('PhotoCraft timeout_ms must be a positive integer.')
    }

    return timeout
  }

  private requireSession(): void {
    if (!this.executionContext?.conversationSessionId) {
      throw new Error('PhotoCraft artifact output requires a conversation session.')
    }
  }

  private validateParams(params: unknown): void {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new Error('PhotoCraft params must be a JSON object.')
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

  private async publishFile(
    filePath: string,
    mimeType: string,
    filename: string
  ): ReturnType<Tool['createArtifact']> {
    if (!(await fs.stat(filePath)).size) {
      throw new Error('PhotoCraft did not produce a non-empty output file.')
    }

    return this.createArtifact(filePath, mimeType, filename)
  }

  private async attachPreview(image: string): Promise<boolean> {
    if ((await fs.stat(image)).size > MAX_MODEL_IMAGE_BYTES) {
      return false
    }

    await this.attachModelFile(image, 'image/png')

    return true
  }
}
