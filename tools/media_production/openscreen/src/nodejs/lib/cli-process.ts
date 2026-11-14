import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import { terminateProcessTree } from '@sdk/utils/process'

const MAX_OUTPUT_CHARACTERS = 1_048_576
const MAX_DIAGNOSTIC_CHARACTERS = 16_000

type CliResult = Record<string, unknown>

/**
 * Runs OpenScreen's finite legacy pack command with bounded NDJSON and cancellation.
 */
export class CliProcess {
  public readonly child: ChildProcessWithoutNullStreams
  public readonly done: Promise<CliResult>
  private running = true
  private canceled = false
  private stdout = ''
  private diagnostics = ''

  public constructor(executable: string, args: string[], onOutput: (text: string) => void) {
    const env = { ...process.env }
    delete env['ELECTRON_RUN_AS_NODE']
    this.child = spawn(executable, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.done = new Promise((resolve, reject) => {
      this.child.stdout.setEncoding('utf8')
      this.child.stderr.setEncoding('utf8')
      this.child.stdout.on('data', (chunk: string) => {
        this.stdout += chunk
        if (this.stdout.length > MAX_OUTPUT_CHARACTERS) {
          this.stdout = ''
          reject(new Error('OpenScreen packing output exceeds its bounded protocol limit.'))
          void this.cancel().catch(() => {})
        }
      })
      this.child.stderr.on('data', (chunk: string) => {
        this.diagnostics = (this.diagnostics + chunk).slice(-MAX_DIAGNOSTIC_CHARACTERS)
        onOutput(chunk.slice(-MAX_DIAGNOSTIC_CHARACTERS))
      })
      this.child.on('error', reject)
      this.child.on('close', (code) => {
        this.running = false
        if (code !== 0 || this.canceled) {
          reject(new Error(`OpenScreen packing failed or was canceled: ${this.diagnostics}`))
          return
        }
        try {
          const events = this.stdout.split('\n').filter((line) => line.trim()).map((line) =>
            JSON.parse(line) as CliResult
          )
          const result = events.findLast((event) => event['event'] === 'done')
          if (!result || result['success'] !== true) {
            throw new Error('OpenScreen did not confirm a completed portable project.')
          }
          resolve(result)
        } catch (error) {
          reject(error)
        }
      })
    })
    void this.done.catch(() => {})
  }

  /**
   * Kills the owned process tree; a partial folder is never a completed pack result.
   */
  public async cancel(): Promise<void> {
    if (!this.running) {
      return
    }
    this.canceled = true
    if (this.child.pid) {
      await terminateProcessTree(this.child.pid, 'SIGKILL')
    }
    await this.done.catch(() => {})
  }

  /**
   * Releases an unfinished command during worker cleanup.
   */
  public async dispose(): Promise<void> {
    await this.cancel()
  }
}
