export enum LocalInferencePriority {
  Foreground = 'foreground',
  Background = 'background'
}

interface WaitingInference {
  priority: LocalInferencePriority
  resolve: (release: () => void) => void
  signal?: AbortSignal | undefined
  abort?: () => void
}

/**
 * Shares one local inference slot without allowing auxiliary requests to take
 * it between an owner's model calls. Active inference always finishes normally.
 */
export class LocalInferenceScheduler {
  private foregroundTurns = 0
  private active = false
  private readonly waiting: WaitingInference[] = []

  /**
   * Reserves foreground priority through tool execution and answer delivery.
   */
  public beginForegroundTurn(): () => void {
    this.foregroundTurns += 1
    let released = false

    return (): void => {
      if (released) {
        return
      }

      released = true
      this.foregroundTurns -= 1
      this.drain()
    }
  }

  /**
   * Waits before the provider starts its inference timeout. Resolving a permit
   * leaves execution in the caller's profile, session and accounting context.
   */
  public acquire(priority: LocalInferencePriority, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()

    return new Promise((resolve, reject) => {
      const entry: WaitingInference = { priority, resolve, signal }
      if (signal) {
        entry.abort = (): void => {
          const index = this.waiting.indexOf(entry)
          if (index !== -1) {
            this.waiting.splice(index, 1)
            reject(signal.reason)
            this.drain()
          }
        }
        signal.addEventListener('abort', entry.abort, { once: true })
      }

      this.waiting.push(entry)
      this.drain()
    })
  }

  private drain(): void {
    if (this.active || this.waiting.length === 0) {
      return
    }

    const foreground = this.waiting.findIndex((entry) =>
      entry.priority === LocalInferencePriority.Foreground
    )
    if (foreground === -1 && this.foregroundTurns > 0) {
      return
    }

    const entry = this.waiting.splice(foreground === -1 ? 0 : foreground, 1)[0]!
    if (entry.abort) {
      entry.signal?.removeEventListener('abort', entry.abort)
    }

    this.active = true
    let released = false
    entry.resolve(() => {
      if (released) {
        return
      }

      released = true
      this.active = false
      this.drain()
    })
  }
}
