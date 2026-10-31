import { LogHelper } from '@/helpers/log-helper'
import { randomUUID } from 'node:crypto'
import { getTurnTimingContext, recordMaintenanceEvent, runWithTurnTiming, TurnStage, type MaintenanceTaskResult } from '@/core/llm-manager/turn-timing'
import { bindConversationSession, getActiveConversationSessionId } from '@/core/session-manager/session-context'
import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'

export type PostTurnMaintenanceTask = () => Promise<void | MaintenanceTaskResult> | void | MaintenanceTaskResult
export type PostTurnMaintenanceTaskPreparer = () =>
  | Promise<PostTurnMaintenanceTask | null>
  | PostTurnMaintenanceTask
  | null

function waitForDisplayPathToUnwind(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/**
 * Serializes post-turn maintenance and owns independent turn-start tasks.
 * Both paths retain isolated attribution and can be drained during shutdown.
 */
export default class PostTurnMaintenanceQueue {
  private queue: Promise<void> = Promise.resolve()
  private pendingCount = 0
  private readonly concurrent = new Set<Promise<void>>()

  public enqueue(label: string, task: PostTurnMaintenanceTask): void {
    this.enqueueIfNeeded(label, () => task)
  }

  /**
   * Serializes a lightweight eligibility check and only announces maintenance
   * when that check returns work to execute.
   */
  public enqueueIfNeeded(
    label: string,
    prepareTask: PostTurnMaintenanceTaskPreparer
  ): void {
    const execute = this.createTask(label, prepareTask, TurnStage.PostTurn)
    this.pendingCount += 1
    this.queue = this.queue.then(execute).finally(() => {
      this.pendingCount = Math.max(0, this.pendingCount - 1)
    })
  }

  /**
   * Starts independent work without waiting behind post-turn maintenance or
   * sharing the foreground turn's timing and inference collections.
   */
  public startConcurrent(label: string, task: PostTurnMaintenanceTask, stage: TurnStage): void {
    const pending = this.createTask(label, () => task, stage)()
    this.concurrent.add(pending)
    void pending.finally(() => this.concurrent.delete(pending))
  }

  private createTask(label: string, prepareTask: PostTurnMaintenanceTaskPreparer, stage: TurnStage): () => Promise<void> {
    const profile = getActiveProfileName()
    const sessionId = getActiveConversationSessionId()
    const taskId = randomUUID()
    const context = {
      turnId: getTurnTimingContext()?.turnId ?? taskId,
      stage,
      taskId,
      task: label
    }
    const record = (outcome: Parameters<typeof recordMaintenanceEvent>[3], details?: MaintenanceTaskResult): Promise<void> =>
      recordMaintenanceEvent(context, profile, sessionId, outcome, details)
    const heading = stage === TurnStage.PostTurn ? 'Post-Turn Maintenance' : 'Turn-Start Maintenance'
    const execute = bindConversationSession(() => runWithProfileContext({ profileName: profile }, () =>
      runWithTurnTiming(context.turnId, sessionId, async () => {
        await record('running')
        const task = await prepareTask()
        if (!task) {
          await record('skipped')
          return
        }

        const startedAt = Date.now()
        LogHelper.title(heading)
        LogHelper.debug(`Running "${label}" | pending=${this.pendingCount}`)
        const result = await task()
        const outcome = result?.outcome ?? 'completed'
        LogHelper.title(heading)
        const summary = `${outcome} "${label}" in ${Date.now() - startedAt}ms` +
          `${result?.reason ? ` | reason=${result.reason}` : ''}` +
          `${result?.issueCount === undefined ? '' : ` | issues=${result.issueCount}`}`
        if (outcome === 'failed' || outcome === 'rejected') {
          LogHelper.warning(summary)
        } else {
          LogHelper.debug(summary)
        }
        await record(outcome, result ?? undefined)
      }, context)
    ))

    void record('queued')
    return async (): Promise<void> => {
      try {
        await waitForDisplayPathToUnwind()
        await execute()
      } catch (error) {
        await record('failed')
        LogHelper.title(heading)
        LogHelper.warning(`Failed "${label}": ${String(error)}`)
      }
    }
  }

  /**
   * Waits for already scheduled work, including maintenance added by that work.
   */
  public async whenIdle(): Promise<void> {
    let pending: Promise<void>
    do {
      pending = this.queue
      await Promise.all([pending, ...this.concurrent])
    } while (pending !== this.queue || this.concurrent.size > 0)
  }
}
