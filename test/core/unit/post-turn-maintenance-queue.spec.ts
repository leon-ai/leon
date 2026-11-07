import { beforeEach, describe, expect, it, vi } from 'vitest'

import PostTurnMaintenanceQueue from '@/core/post-turn-maintenance-queue'
import { LogHelper } from '@/helpers/log-helper'
import { TurnStage } from '@/core/llm-manager/turn-timing'
import { runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { runWithConversationSession } from '@/core/session-manager/session-context'
import { LocalInferenceScheduler, LocalInferencePriority } from '@/core/llm-manager/local-inference-scheduler'

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

  it('runs turn-start tasks past blocked post-turn work and drains both paths', async () => {
    vi.spyOn(LogHelper, 'title').mockImplementation(() => undefined)
    vi.spyOn(LogHelper, 'debug').mockImplementation(() => undefined)
    const gate = Promise.withResolvers<void>()
    const task = vi.fn()
    const queue = new PostTurnMaintenanceQueue()
    queue.enqueue('blocked maintenance', () => gate.promise)
    queue.startConcurrent('session title generation', task, TurnStage.PreTurn)
    let drained = false
    const idle = queue.whenIdle().then(() => {
      drained = true
    })

    try {
      await vi.waitFor(() => expect(task).toHaveBeenCalledOnce())
      expect(drained).toBe(false)
    } finally {
      gate.resolve()
      await idle
    }
    expect(drained).toBe(true)
  })

  it('bounds pending batches and never appends to an executing batch', async () => {
    const queue = new PostTurnMaintenanceQueue()
    const gate = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const batches: number[][] = []
    const execute = async (items: number[]): Promise<void> => {
      batches.push(items)
      started.resolve()
      await gate.promise
    }

    for (let item = 0; item < 5; item += 1) {
      queue.enqueueBatch('extraction', item, 3, execute)
    }
    await started.promise
    queue.enqueueBatch('extraction', 5, 3, execute)
    queue.enqueueBatch('extraction', 6, 3, execute)
    expect(batches).toEqual([[0, 1, 2]])
    gate.resolve()
    await queue.whenIdle()
    expect(batches).toEqual([[0, 1, 2], [3, 4, 5], [6]])
  })

  it('keeps pending batches isolated by profile and conversation', async () => {
    const queue = new PostTurnMaintenanceQueue()
    const batches: string[][] = []
    for (const [profile, session, item] of [
      ['one', 'shared', 'first'], ['two', 'shared', 'second'],
      ['one', 'other', 'third'], ['one', 'shared', 'fourth']
    ]) {
      runWithProfileContext({ profileName: profile! }, () =>
        runWithConversationSession({ sessionId: session! }, () => {
          queue.enqueueBatch('extraction', item!, 3, (items) => {
            batches.push(items)
          })
        })
      )
    }
    await queue.whenIdle()
    expect(batches).toEqual([['first', 'fourth'], ['second'], ['third']])
  })
})

describe('local inference scheduling', () => {
  it('finishes active work and keeps queued auxiliary inference behind the whole foreground turn', async () => {
    const scheduler = new LocalInferenceScheduler()
    const first = await scheduler.acquire(LocalInferencePriority.Background)
    const backgroundStarted = vi.fn()
    const pending = scheduler.acquire(LocalInferencePriority.Background).then((release) => {
      backgroundStarted()
      release()
    })
    const endTurn = scheduler.beginForegroundTurn()
    const foreground = scheduler.acquire(LocalInferencePriority.Foreground)
    first()
    const release = await foreground

    expect(backgroundStarted).not.toHaveBeenCalled()
    release()
    await Promise.resolve()
    expect(backgroundStarted).not.toHaveBeenCalled()
    endTurn()
    endTurn()
    await pending
    expect(backgroundStarted).toHaveBeenCalledOnce()
  })

  it('removes canceled waiters without consuming the next inference permit', async () => {
    const scheduler = new LocalInferenceScheduler()
    const active = await scheduler.acquire(LocalInferencePriority.Foreground)
    const controller = new AbortController()
    const reason = new Error('Owner canceled')
    const canceled = scheduler.acquire(LocalInferencePriority.Foreground, controller.signal)
    const rejected = expect(canceled).rejects.toBe(reason)
    controller.abort(reason)
    await rejected
    const next = scheduler.acquire(LocalInferencePriority.Background)
    active()
    const release = await next
    release()
  })

  it('retains profile and session attribution when another profile releases the slot', async () => {
    const scheduler = new LocalInferenceScheduler()
    const first = await scheduler.acquire(LocalInferencePriority.Foreground)
    const result = runWithProfileContext({ profileName: 'queued-owner' }, () =>
      runWithConversationSession({ sessionId: 'queued-session' }, async () => {
        const release = await scheduler.acquire(LocalInferencePriority.Background)
        const { getActiveProfileName } = await import('@/core/profile-runtime/profile-context')
        const { getActiveConversationSessionId } = await import('@/core/session-manager/session-context')
        const scope = [getActiveProfileName(), getActiveConversationSessionId()]
        release()
        return scope
      })
    )
    runWithProfileContext({ profileName: 'active-owner' }, first)
    expect(await result).toEqual(['queued-owner', 'queued-session'])
  })
})
