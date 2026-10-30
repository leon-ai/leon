import type { MessageLog } from '@/types'
import { LogHelper } from '@/helpers/log-helper'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { CONVERSATION_REPOSITORY } from '@/core/session-manager/conversation-repository'
import type { ConversationWriteOptions } from '@/core/session-manager/conversation-repository'
import {
  getActiveConversationSessionId,
  getActiveTurnInference
} from '@/core/session-manager/session-context'

interface ConversationLoggerSettings {
  loggerName: string
  fileName: string
  filePath?: string
  nbOfLogsToKeep: number
  nbOfLogsToLoad: number
}

interface LoadParams {
  nbOfLogsToLoad?: number
  sessionId?: string
  sortBySentAt?: boolean
}

/**
 * Preserves the logging API while retaining owner history separately from the
 * bounded model window. SQLite orders writes without an asynchronous file queue
 * holding unrelated sessions behind full-history reads and rewrites.
 */
export class ConversationLogger {
  public constructor(private readonly settings: ConversationLoggerSettings) {
    LogHelper.title(settings.loggerName)
    LogHelper.success('New instance')
  }

  public get loggerName(): string {
    return this.settings.loggerName
  }

  private resolveSessionId(sessionId?: string): string {
    const resolved = sessionId || getActiveConversationSessionId() ||
      CONVERSATION_SESSION_MANAGER.getActiveSessionId()
    if (!CONVERSATION_SESSION_MANAGER.getSession(resolved)) {
      throw new Error('The conversation session no longer exists.')
    }

    return resolved
  }

  /**
   * Appends a visible message or updates its stable trace identity.
   */
  public async push(record: Omit<MessageLog, 'sentAt'>): Promise<void> {
    await this.upsert(record)
  }

  /**
   * Captures attribution before persistence; failed writes must reach the caller.
   */
  public async upsert(
    record: Omit<MessageLog, 'sentAt'>,
    options: ConversationWriteOptions = {}
  ): Promise<void> {
    const sessionId = this.resolveSessionId(options.sessionId)
    const inference = getActiveTurnInference()
    const attributed = record.who === 'leon' && !('inference' in record) &&
      inference !== undefined &&
      (!options.sessionId || options.sessionId === getActiveConversationSessionId())
      ? { ...record, inference }
      : record

    CONVERSATION_REPOSITORY.upsertMessage(sessionId, attributed, options)
    CONVERSATION_SESSION_MANAGER.updateSessionFromStoredMessages(sessionId)
  }

  /**
   * Loads only the requested recent model-context window.
   */
  public async load(options: LoadParams = {}): Promise<MessageLog[]> {
    const messages = CONVERSATION_REPOSITORY.readRecentMessages(
      this.resolveSessionId(options.sessionId),
      options.nbOfLogsToLoad || this.settings.nbOfLogsToLoad,
      options.sortBySentAt ?? false
    )
    if (options.sortBySentAt) {
      messages.sort((left, right) => left.sentAt - right.sentAt)
    }

    return messages
  }

  /**
   * Supports explicit archive consumers; UI reads use cursor pages instead.
   */
  public async loadAll(options: { sessionId?: string } = {}): Promise<MessageLog[]> {
    return CONVERSATION_REPOSITORY.readAllMessages(this.resolveSessionId(options.sessionId))
  }

  /**
   * Keeps compaction's rolling window independent from indefinite archive retention.
   */
  public async loadContextWindow(): Promise<MessageLog[]> {
    return CONVERSATION_REPOSITORY.readContextMessages(this.resolveSessionId(), this.settings.nbOfLogsToKeep)
  }

  /**
   * Clears only the requested conversation without touching other sessions.
   */
  public async clear(options: { sessionId?: string } = {}): Promise<void> {
    const sessionId = this.resolveSessionId(options.sessionId)

    CONVERSATION_REPOSITORY.clearMessages(sessionId)
    CONVERSATION_SESSION_MANAGER.updateSessionFromStoredMessages(sessionId)
  }
}
