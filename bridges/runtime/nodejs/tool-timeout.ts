import {
  MAX_TOOL_TIMEOUT_MS,
  type ToolTimeoutPolicy
} from '../contracts/tool-runtime-types'

/**
 * Tracks one executing call independently of task deadlines and retained work.
 */
export class ToolTimeout {
  private readonly controller = new AbortController()
  public readonly signal: AbortSignal = this.controller.signal
  private idleTimer: NodeJS.Timeout | undefined
  private totalTimer: NodeJS.Timeout | undefined

  constructor(policy: ToolTimeoutPolicy) {
    const { idleMs, totalMs } = policy

    for (const duration of [idleMs, totalMs]) {
      if (duration !== undefined && (
        !Number.isInteger(duration) || duration < 1 || duration > MAX_TOOL_TIMEOUT_MS
      )) {
        throw new RangeError(`Tool timeouts must be integers between 1 and ${MAX_TOOL_TIMEOUT_MS}ms.`)
      }
    }

    const expire = (kind: 'idle' | 'total', duration: number): void => {
      this.controller.abort(new DOMException(
        `Tool execution exceeded its ${kind} timeout (${duration}ms).`,
        'TimeoutError'
      ))
      this.dispose()
    }

    if (idleMs !== undefined) {
      this.idleTimer = setTimeout(() => expire('idle', idleMs), idleMs)
      this.idleTimer.unref()
    }
    if (totalMs !== undefined) {
      this.totalTimer = setTimeout(() => expire('total', totalMs), totalMs)
      this.totalTimer.unref()
    }
  }

  /**
   * Renew only inactivity; activity never extends the total limit.
   */
  public touch(): void {
    if (!this.signal.aborted) {
      this.idleTimer?.refresh()
    }
  }

  /**
   * Release timers as soon as this call settles.
   */
  public dispose(): void {
    clearTimeout(this.idleTimer)
    clearTimeout(this.totalTimer)
    this.idleTimer = undefined
    this.totalTimer = undefined
  }
}
