import { randomUUID } from 'node:crypto'
import { TOOL_EXECUTION_WAIT_MS, TOOL_EXECUTION_MAX_WAIT_MS } from '@/constants'

import type { ToolExecutionResult } from './tool-executor'
import type { ToolRuntimeProgress } from '@sdk/tool-runtime-types'

const RETENTION_MS = 15 * 60_000
const MAX_EXECUTIONS_PER_PROFILE = 32
const MAX_ACTIVE_EXECUTIONS_PER_PROFILE = 8

export enum ToolExecutionState {
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Canceled = 'canceled'
}

interface ToolExecution {
  id: string
  profileName: string
  sessionId: string
  tool: string
  state: ToolExecutionState
  startedAt: number
  completedAt?: number
  progress?: ToolRuntimeProgress
  result?: ToolExecutionResult
  error?: string
  controller: AbortController
  settled: Promise<void>
}

/**
 * Retains execution handles and results without reissuing tool calls.
 * Every lookup checks both profile and conversation ownership.
 */
export class ToolExecutionManager {
  private readonly executions = new Map<string, ToolExecution>()

  /**
   * Start one execution, retaining cancellation and progress until it settles.
   */
  public start(
    profileName: string,
    sessionId: string,
    tool: string,
    execute: (
      signal: AbortSignal,
      progress: (value: ToolRuntimeProgress) => void
    ) => Promise<ToolExecutionResult>,
    signal?: AbortSignal
  ): string {
    signal?.throwIfAborted()
    this.prune()
    const owned = [...this.executions.values()].filter((execution) =>
      execution.profileName === profileName
    )

    if (owned.filter((execution) => execution.state === ToolExecutionState.Running).length >=
        MAX_ACTIVE_EXECUTIONS_PER_PROFILE) {
      throw new Error('Too many active tool executions; wait for or cancel an existing execution.')
    }

    if (owned.length >= MAX_EXECUTIONS_PER_PROFILE) {
      const completed = owned.find((execution) => execution.completedAt !== undefined)
      if (!completed) {
        throw new Error('Too many active tool executions; wait for or cancel an existing execution.')
      }

      this.executions.delete(completed.id)
    }

    const controller = new AbortController()
    const execution: ToolExecution = {
      id: randomUUID(),
      profileName,
      sessionId,
      tool,
      state: ToolExecutionState.Running,
      startedAt: Date.now(),
      controller,
      settled: Promise.resolve()
    }
    const abort = (): void => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    this.executions.set(execution.id, execution)
    execution.settled = Promise.resolve().then(async () => {
      try {
        execution.result = await execute(controller.signal, (progress) => {
          execution.progress = progress
        })
        execution.state = execution.result.status === 'success'
          ? ToolExecutionState.Completed
          : ToolExecutionState.Failed
      } catch (error) {
        execution.error = String(error)
        execution.state = ToolExecutionState.Failed
      } finally {
        if (controller.signal.aborted) {
          execution.state = ToolExecutionState.Canceled
        }

        execution.completedAt = Date.now()
        signal?.removeEventListener('abort', abort)
      }
    })

    return execution.id
  }

  /**
   * Wait for the same execution; a wait timeout never cancels or restarts it.
   */
  public async wait(
    profileName: string,
    sessionId: string,
    id: string,
    waitMs = TOOL_EXECUTION_WAIT_MS
  ): Promise<ReturnType<ToolExecutionManager['read']>> {
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > TOOL_EXECUTION_MAX_WAIT_MS) {
      throw new Error(`waitMs must be from 0 to ${TOOL_EXECUTION_MAX_WAIT_MS}`)
    }

    const execution = this.get(profileName, sessionId, id)
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      await Promise.race([
        execution.settled,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, waitMs)
        })
      ])
    } finally {
      clearTimeout(timer)
    }

    return this.read(profileName, sessionId, id)
  }

  /**
   * Read a retained snapshot without rerunning the underlying tool.
   */
  public read(profileName: string, sessionId: string, id: string): {
    execution: {
      id: string
      tool: string
      state: ToolExecutionState
      startedAt: number
      completedAt?: number
      progress?: ToolRuntimeProgress
      error?: string
    }
    result?: ToolExecutionResult
  } {
    const execution = this.get(profileName, sessionId, id)

    return {
      execution: {
        id: execution.id,
        tool: execution.tool,
        state: execution.state,
        startedAt: execution.startedAt,
        ...(execution.completedAt !== undefined ? { completedAt: execution.completedAt } : {}),
        ...(execution.progress ? { progress: execution.progress } : {}),
        ...(execution.error ? { error: execution.error } : {})
      },
      ...(execution.result ? { result: execution.result } : {})
    }
  }

  /**
   * Cancel only the owned execution and wait for worker cleanup.
   */
  public async cancel(profileName: string, sessionId: string, id: string): Promise<ReturnType<ToolExecutionManager['read']>> {
    const execution = this.get(profileName, sessionId, id)

    if (execution.state === ToolExecutionState.Running) {
      execution.controller.abort(new Error('Tool execution canceled.'))
    }

    return this.wait(profileName, sessionId, id)
  }

  /**
   * Stop retained executions during host shutdown.
   */
  public async dispose(): Promise<void> {
    for (const execution of this.executions.values()) {
      if (execution.state === ToolExecutionState.Running) {
        execution.controller.abort(new Error('Tool host shutting down.'))
      }
    }

    await Promise.all([...this.executions.values()].map((execution) => execution.settled))
    this.executions.clear()
  }

  private get(profileName: string, sessionId: string, id: string): ToolExecution {
    this.prune()
    const execution = this.executions.get(id)

    if (!execution || execution.profileName !== profileName || execution.sessionId !== sessionId) {
      throw new Error('Tool execution not found in this conversation.')
    }

    return execution
  }

  private prune(): void {
    const cutoff = Date.now() - RETENTION_MS

    for (const execution of this.executions.values()) {
      if (execution.completedAt !== undefined && execution.completedAt < cutoff) {
        this.executions.delete(execution.id)
      }
    }
  }
}

export const TOOL_EXECUTION_MANAGER = new ToolExecutionManager()
