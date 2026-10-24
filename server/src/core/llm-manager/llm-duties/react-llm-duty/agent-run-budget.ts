import { performance } from 'node:perf_hooks'

import { AGENT_RUN_FINISHING_RESERVE_MS } from './agent-constants'

const MAX_TIMER_DELAY_MS = 2_147_483_647

/**
 * Distinguishes a caller's run deadline from provider stalls and owner cancellation.
 */
export class AgentRunDeadlineError extends Error {
  constructor() {
    super('The task reached its run deadline.')
    this.name = 'AgentRunDeadlineError'
  }
}

/**
 * Shares one optional, non-renewable deadline across work, recovery and finishing.
 */
export class AgentRunBudget {
  public readonly finishingReserveMs: number
  public readonly signal: AbortSignal | undefined
  private readonly expiresAt: number | undefined
  private readonly controller: AbortController | undefined
  private timer: NodeJS.Timeout | undefined

  constructor(public readonly deadlineAt?: number) {
    if (deadlineAt === undefined) {
      this.finishingReserveMs = 0
      return
    }

    if (!Number.isFinite(deadlineAt)) {
      throw new RangeError('Agent deadlineAt must be a finite epoch time in milliseconds.')
    }

    const durationMs = Math.max(0, deadlineAt - Date.now())
    this.expiresAt = performance.now() + durationMs
    // Keep short runs useful while reserving at most one minute to finish.
    this.finishingReserveMs = Math.min(AGENT_RUN_FINISHING_RESERVE_MS, durationMs / 3)
    this.controller = new AbortController()
    this.signal = this.controller.signal
    this.scheduleExpiry()
  }

  public get remainingMs(): number | undefined {
    return this.expiresAt === undefined
      ? undefined
      : Math.max(0, this.expiresAt - performance.now())
  }

  public get isFinishing(): boolean {
    return this.remainingMs !== undefined && this.remainingMs <= this.finishingReserveMs
  }

  public get isExpired(): boolean {
    return this.signal?.aborted === true || this.remainingMs === 0
  }

  /**
   * Rejects new work even when the event loop has not delivered the timer yet.
   */
  public throwIfExpired(): void {
    if (this.isExpired) {
      this.controller?.abort(new AgentRunDeadlineError())
      this.signal?.throwIfAborted()
    }
  }

  /**
   * Applies the same remaining budget to every new request and retry policy.
   */
  public capTimeout(timeoutMs: number): number {
    this.throwIfExpired()
    return Math.min(timeoutMs, this.remainingMs ?? timeoutMs)
  }

  /**
   * Releases the deadline timer after the session checkpoint has been saved.
   */
  public dispose(): void {
    clearTimeout(this.timer)
  }

  private scheduleExpiry(): void {
    const remainingMs = this.remainingMs

    if (remainingMs === undefined) {
      return
    }

    if (remainingMs <= 0) {
      this.controller?.abort(new AgentRunDeadlineError())
      return
    }

    this.timer = setTimeout(() => {
      this.scheduleExpiry()
    }, Math.min(Math.ceil(remainingMs), MAX_TIMER_DELAY_MS))
    this.timer.unref?.()
  }
}
