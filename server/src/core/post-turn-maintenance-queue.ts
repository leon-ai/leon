import { LogHelper } from '@/helpers/log-helper'

type PostTurnMaintenanceTask = () => Promise<void> | void

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
    this.pendingCount += 1
    this.queue = this.queue.then(async () => {
      const startedAt = Date.now()

      try {
        await waitForDisplayPathToUnwind()
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
