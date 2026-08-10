import { LogHelper } from '@/helpers/log-helper'

export type PostTurnMaintenanceTask = () => Promise<void> | void
type PostTurnMaintenanceTaskPreparer = () =>
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
    this.pendingCount += 1
    this.queue = this.queue.then(async () => {
      try {
        await waitForDisplayPathToUnwind()
        const task = await prepareTask()

        if (!task) {
          return
        }

        const startedAt = Date.now()
        LogHelper.title('Post-Turn Maintenance')
        LogHelper.debug(
          `Running "${label}" | pending=${this.pendingCount}`
        )
        await task()
        LogHelper.title('Post-Turn Maintenance')
        LogHelper.debug(
          `Completed "${label}" in ${Date.now() - startedAt}ms`
        )
      } catch (error) {
        LogHelper.title('Post-Turn Maintenance')
        LogHelper.warning(`Failed "${label}": ${String(error)}`)
      } finally {
        this.pendingCount = Math.max(0, this.pendingCount - 1)
      }
    })
  }
}
