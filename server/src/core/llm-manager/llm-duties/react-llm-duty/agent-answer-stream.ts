import type { LeonClientInterfaceTokenPayload } from '@/core/leon-interface/types'
import { StringHelper } from '@/helpers/string-helper'

/**
 * Tracks the provisional text of one agent response until it is accepted.
 */
export class AgentAnswerStream {
  private generationId: string | null = null

  constructor(
    private readonly emit: (payload: LeonClientInterfaceTokenPayload) => void
  ) {}

  /**
   * Forwards provider text immediately; a stream-start marker clears retry text.
   */
  public push(token: string): void {
    if (!token) {
      this.discard()
      return
    }

    this.generationId ??= StringHelper.random(6, { onlyLetters: true })
    this.emit({
      token: StringHelper.normalizeUserFacingText(token),
      generationId: this.generationId
    })
  }

  /**
   * Releases accepted text without replaying or removing its client bubble.
   */
  public finish(): string | null {
    const generationId = this.generationId
    this.generationId = null
    return generationId
  }

  /**
   * Removes a rejected or interrupted draft before another attempt starts.
   */
  public discard(): void {
    const generationId = this.finish()
    if (generationId) {
      this.emit({ token: '', generationId, reset: true })
    }
  }
}
