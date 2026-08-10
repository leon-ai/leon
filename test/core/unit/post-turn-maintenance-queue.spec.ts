import { beforeEach, describe, expect, it, vi } from 'vitest'

import PostTurnMaintenanceQueue from '@/core/post-turn-maintenance-queue'
import { LogHelper } from '@/helpers/log-helper'

describe('PostTurnMaintenanceQueue', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('does not announce or execute maintenance when it is not needed', async () => {
    const titleSpy = vi.spyOn(LogHelper, 'title').mockImplementation(() => undefined)
    const debugSpy = vi.spyOn(LogHelper, 'debug').mockImplementation(() => undefined)
    const task = vi.fn()
    const queue = new PostTurnMaintenanceQueue()

    queue.enqueueIfNeeded('history compaction', async () => null)
    queue.enqueue('following task', task)

    await vi.waitFor(() => expect(task).toHaveBeenCalledOnce())
    expect(titleSpy).toHaveBeenCalledTimes(2)
    expect(debugSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('history compaction')
    )
  })

  it('executes maintenance returned by its eligibility check', async () => {
    vi.spyOn(LogHelper, 'title').mockImplementation(() => undefined)
    vi.spyOn(LogHelper, 'debug').mockImplementation(() => undefined)
    const task = vi.fn()
    const queue = new PostTurnMaintenanceQueue()

    queue.enqueueIfNeeded('history compaction', async () => task)
    queue.enqueue('following task', () => undefined)

    await vi.waitFor(() => expect(task).toHaveBeenCalledOnce())
  })
})
