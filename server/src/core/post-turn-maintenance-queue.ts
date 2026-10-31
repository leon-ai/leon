import { LogHelper } from '@/helpers/log-helper'
import { randomUUID } from 'node:crypto'
import { getTurnTimingContext, recordMaintenanceEvent, runWithTurnTiming, TurnStage } from '@/core/llm-manager/turn-timing'
import { bindConversationSession, getActiveConversationSessionId } from '@/core/session-manager/session-context'
import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'

export type PostTurnMaintenanceTask = () => Promise<void> | void
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
 * Serializes background LLM maintenance so it does not compete with itself
 * after an answer has already been produced.
 */
export default class PostTurnMaintenanceQueue {
  private queue: Promise<void> = Promise.resolve()
  private pendingCount = 0

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
    const profile = getActiveProfileName()
    const sessionId = getActiveConversationSessionId()
    const taskId = randomUUID()
    const context = {
      turnId: getTurnTimingContext()?.turnId ?? taskId,
      stage: TurnStage.PostTurn,
      taskId,
      task: label
    }
    const record = (outcome: Parameters<typeof recordMaintenanceEvent>[3]): Promise<void> =>
      recordMaintenanceEvent(context, profile, sessionId, outcome)
    const execute = bindConversationSession(() => runWithProfileContext({ profileName: profile }, () =>
      runWithTurnTiming(context.turnId, sessionId, async () => {
        await record('running')
        const task = await prepareTask()
        if (!task) {
          await record('skipped')
          return
        }

        const startedAt = Date.now()
        LogHelper.title('Post-Turn Maintenance')
        LogHelper.debug(`Running "${label}" | pending=${this.pendingCount}`)
        await task()
        LogHelper.title('Post-Turn Maintenance')
        LogHelper.debug(`Completed "${label}" in ${Date.now() - startedAt}ms`)
        await record('completed')
      }, context)
    ))

    void record('queued')
    this.pendingCount += 1
    this.queue = this.queue.then(async () => {
      try {
        await waitForDisplayPathToUnwind()
        await execute()
      } catch (error) {
        await record('failed')
        LogHelper.title('Post-Turn Maintenance')
        LogHelper.warning(`Failed "${label}": ${String(error)}`)
      } finally {
        this.pendingCount = Math.max(0, this.pendingCount - 1)
      }
    })
  }

  /**
   * Waits for already scheduled work, including maintenance added by that work.
   */
  public async whenIdle(): Promise<void> {
    let pending: Promise<void>
    do {
      pending = this.queue
      await pending
    } while (pending !== this.queue)
  }
}
