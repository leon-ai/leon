import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface, type Interface } from 'node:readline'

import execa, { type ExecaChildProcess } from 'execa'

import type { DocumentLayout } from './document-layout'

export interface OcrResult {
  text: string
  layout?: DocumentLayout
}

const DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const PYTHON = path.join(DIRECTORY, '..', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const TIMEOUT_MS = 120_000
const MAX_ERROR_CHARS = 4_096

/**
 * Keep the tool-owned OCR model resident, without a separately managed service.
 */
export class LocalOcr {
  private process: ExecaChildProcess | undefined
  private lines: Interface | undefined
  private stderr = ''
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  /**
   * Resolve managed resources lazily so text-only reads need no OCR download.
   */
  public constructor(private readonly resolveResources?: () => Promise<string[]>) {}

  /**
   * Serialize requests so concurrent tool calls cannot mix OCR responses.
   */
  public recognize(image: Buffer): Promise<OcrResult> {
    const task = this.queue.then(async () => {
      if (this.disposed) throw new Error('Local OCR has been disposed.')
      return this.request(image)
    })
    this.queue = task.catch(() => undefined)
    return task
  }

  /**
   * Kill only this tool's worker; its models must not outlive the profile.
   */
  public async dispose(): Promise<void> {
    this.disposed = true
    await this.stopWorker()
  }

  private async stopWorker(): Promise<void> {
    const child = this.process
    this.process = undefined
    this.lines?.close()
    this.lines = undefined
    if (child) {
      child.kill('SIGTERM', { forceKillAfterTimeout: 1_000 })
      await child.catch(() => undefined)
    }
  }

  private async request(image: Buffer): Promise<OcrResult> {
    if (!this.process) {
      if (!this.resolveResources) throw new Error('OCR requires the file tool resource resolver.')
      const resourceRoots = await this.resolveResources()
      this.stderr = ''
      this.process = execa(PYTHON, ['-u', path.join(DIRECTORY, 'ocr_worker.py'), ...resourceRoots], {
        buffer: false, env: { PYTHONIOENCODING: 'utf-8' }
      })
      this.process.catch(() => undefined)
      this.process.stderr!.on('data', (chunk: Buffer) => {
        this.stderr = (this.stderr + chunk.toString()).slice(-MAX_ERROR_CHARS)
      })
      this.lines = createInterface({ input: this.process.stdout! })
    }
    const child = this.process
    const lines = this.lines!
    try {
      return await new Promise<OcrResult>((resolve, reject) => {
        const cleanup = (): void => {
          clearTimeout(timer)
          lines.off('line', onLine)
          child.off('error', onError)
          child.off('close', onClose)
        }
        const onError = (error: Error): void => { cleanup(); reject(error) }
        const onClose = (): void => onError(new Error(`Local OCR stopped. ${this.stderr}`))
        const onLine = (line: string): void => {
          try {
            const result = JSON.parse(line) as OcrResult & { error?: string }
            if (result.error || typeof result.text !== 'string') throw new Error(result.error ?? 'Invalid OCR response')
            cleanup()
            resolve({ text: result.text, layout: result.layout })
          } catch (error) { onError(error as Error) }
        }
        const timer = setTimeout(() => onError(new Error('Local OCR timed out.')), TIMEOUT_MS)
        lines.once('line', onLine)
        child.once('error', onError)
        child.once('close', onClose)
        child.stdin!.write(`${JSON.stringify({ image: image.toString('base64') })}\n`, (error) => {
          if (error) onError(error)
        })
      })
    } catch (error) {
      await this.stopWorker()
      throw error
    }
  }
}
