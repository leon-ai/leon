import type { LeonClientInterfaceTokenPayload } from '@/core/leon-interface/types'
import { StringHelper } from '@/helpers/string-helper'

/**
 * Tracks the provisional text of one agent response until it is accepted.
 */
export class AgentAnswerStream {
  private pendingText = ''

  constructor(
    private readonly emit: (payload: LeonClientInterfaceTokenPayload) => void
  ) {}

  /**
   * Buffers provider text until the loop classifies progress or accepts an ending.
   */
  public push(token: string): void {
    if (!token) {
      this.discard()
      return
    }

    this.pendingText += this.pendingText ? token : token.trimStart()
  }

  /**
   * Publishes accepted text once, retaining a generation ID for the answer event.
   */
  public finish(): string | null {
    const token = StringHelper.normalizeUserFacingText(this.pendingText)

    this.pendingText = ''
    if (!token) {
      return null
    }

    const generationId = StringHelper.random(6, { onlyLetters: true })

    this.emit({ token, generationId })

    return generationId
  }

  /**
   * Drops rejected drafts privately so visible messages never need retracting.
   */
  public discard(): void {
    this.pendingText = ''
  }
}
