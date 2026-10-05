import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'

import { CODEBASE_PATH, NODE_RUNTIME_BIN_PATH, NODEJS_BRIDGE_ROOT_PATH,
  NODEJS_BRIDGE_TOOL_RUNTIME_SRC_PATH, TSX_CLI_PATH } from '@/constants'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import type { ToolExecutionContext, ToolRuntimeResult } from '@sdk/tool-runtime-types'
import { ToolRuntimeLifetime, type ToolWorkerResponse } from '@bridge/tool-runtime-types'

const SHUTDOWN_TIMEOUT_MS = 10_000
const DIAGNOSTIC_LIMIT = 16_000

interface Worker {
  process: ChildProcess
  closed: Promise<void>
  result?: (message: ToolWorkerResponse) => void
  fail?: (message: string) => void
  log?: (line: string) => void
  diagnostics: string
}

/**
 * Owns generic tool processes; native state and cleanup remain inside each tool.
 */
export class ToolWorkerManager {
  private readonly workers = new Map<string, Worker>()
  private readonly tails = new Map<string, Promise<void>>()
  private closing = false

  /**
   * Serialize one tool across profiles, since it may share a physical device.
   */
  public async execute(context: ToolExecutionContext, args: unknown[], log: (line: string) => void): Promise<ToolRuntimeResult> {
    const toolKey = JSON.stringify([context.toolkitId, context.toolId])
    const previous = this.tails.get(toolKey) ?? Promise.resolve()
    const execution = previous.then(() => {
      if (this.closing || context.signal?.aborted) return this.failure('Tool execution canceled before dispatch.')
      return this.dispatch(context, args, log)
    })
    const tail = execution.then(() => undefined, () => undefined)
    this.tails.set(toolKey, tail)
    try { return await execution } finally {
      if (this.tails.get(toolKey) === tail) this.tails.delete(toolKey)
    }
  }

  /**
   * Drain active calls and release workers on both the server and Satellite.
   */
  public async dispose(): Promise<void> {
    this.closing = true
    await Promise.all([...this.workers.values()].map((worker) => this.stop(worker)))
    await Promise.all(this.tails.values())
    this.workers.clear()
  }

  private create(context: ToolExecutionContext, key: string): Worker {
    const child = spawn(NODE_RUNTIME_BIN_PATH, [TSX_CLI_PATH, '--tsconfig',
      path.join(NODEJS_BRIDGE_ROOT_PATH, 'tsconfig.json'), NODEJS_BRIDGE_TOOL_RUNTIME_SRC_PATH,
      '--runtime', 'tool', '--toolkit', context.toolkitId, '--tool', context.toolId], {
      cwd: NODEJS_BRIDGE_ROOT_PATH,
      env: { ...RuntimeHelper.getManagedNodeEnvironment(), LEON_CODEBASE_PATH: CODEBASE_PATH,
        LEON_PROFILE: context.profileName, LEON_SESSION_ID: context.conversationSessionId || '' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    const worker: Worker = { process: child, diagnostics: '', closed: new Promise((resolve) => child.once('close', () => resolve())) }
    let pendingLine = ''
    child.stderr?.on('data', (data: Buffer) => {
      worker.diagnostics = (worker.diagnostics + data.toString()).slice(-DIAGNOSTIC_LIMIT)
      pendingLine += data.toString()
      const lines = pendingLine.split('\n')
      pendingLine = lines.pop() || ''
      for (const line of lines) worker.log?.(line)
    })
    child.stdout?.on('data', (data: Buffer) => {
      worker.diagnostics = (worker.diagnostics + data.toString()).slice(-DIAGNOSTIC_LIMIT)
    })
    child.on('message', (message: ToolWorkerResponse) => {
      if (message.type === 'result') worker.result?.(message)
    })
    child.on('error', (error) => worker.fail?.(error.message))
    child.on('close', () => {
      if (this.workers.get(key) === worker) this.workers.delete(key)
      if (pendingLine) worker.log?.(pendingLine)
      worker.fail?.('Tool worker exited before returning its result. Input may have been delivered; inspect before retrying.')
    })
    this.workers.set(key, worker)
    return worker
  }

  private async dispatch(context: ToolExecutionContext, args: unknown[], log: (line: string) => void): Promise<ToolRuntimeResult> {
    const key = JSON.stringify([context.profileName, context.toolkitId, context.toolId])
    const worker = this.workers.get(key) ?? this.create(context, key)
    worker.log = log
    worker.diagnostics = ''
    const abort = (): void => { void this.stop(worker) }
    context.signal?.addEventListener('abort', abort, { once: true })
    let retire = false
    const result = await new Promise<ToolRuntimeResult>((resolve) => {
      const finish = (value: ToolRuntimeResult): void => {
        delete worker.result
        delete worker.fail
        resolve(value)
      }
      worker.fail = (message): void => { retire = true; finish(this.failure(message, worker.diagnostics)) }
      worker.result = (message): void => {
        retire = message.lifetime !== ToolRuntimeLifetime.Persistent
        finish(message.result)
      }
      // Progress callbacks are local; only serializable call context crosses IPC.
      const callContext = { ...context }
      delete callContext.onProgress
      delete callContext.signal
      worker.process.send({ type: 'execute', context: callContext, args }, (error) => {
        if (error) worker.fail?.(error.message)
      })
    })
    context.signal?.removeEventListener('abort', abort)
    if (retire || context.signal?.aborted) {
      this.workers.delete(key)
      await this.stop(worker)
    }
    delete worker.log
    return context.signal?.aborted
      ? { ...result, success: false, message: 'Tool execution canceled. Inspect any delivered input before retrying.' }
      : result
  }

  private async stop(worker: Worker): Promise<void> {
    const timer = setTimeout(() => worker.process.kill('SIGKILL'), SHUTDOWN_TIMEOUT_MS)
    try {
      if (worker.process.connected) worker.process.send({ type: 'shutdown' }, () => {})
      await worker.closed
    } finally { clearTimeout(timer) }
  }

  private failure(message: string, diagnostics = ''): ToolRuntimeResult {
    return { success: false, message, output: { runtime_stderr: diagnostics } }
  }
}
