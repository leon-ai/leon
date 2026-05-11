import path from 'node:path'
import fs from 'node:fs'

import type { ConversationWidgetData, LLMAnswerMetrics, MessageLog } from '@/types'
import { LogHelper } from '@/helpers/log-helper'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'

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
}

interface UpsertParams {
  replaceMessageId?: string | null
  refreshSentAt?: boolean
  sessionId?: string
}

/**
 * The goal of this class is to log the conversation data between the
 * owner and Leon.
 * This data is saved on the owner's machine.
 * This data can then be used to provide more context to the LLM to achieve
 * better results.
 */
export class ConversationLogger {
  private readonly settings: ConversationLoggerSettings
  private operations = Promise.resolve()
  private static readonly WIDGET_PLACEHOLDER_PREFIX =
    '__LEON_INLINE_WIDGET__'
  private static readonly LLM_METRICS_PLACEHOLDER_PREFIX =
    '__LEON_INLINE_LLM_METRICS__'

  get loggerName(): string {
    return this.settings.loggerName
  }

  constructor(settings: ConversationLoggerSettings) {
    LogHelper.title(settings.loggerName)
    LogHelper.success('New instance')

    this.settings = settings
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const nextOperation = this.operations.then(operation, operation)

    this.operations = nextOperation.then(
      () => undefined,
      () => undefined
    )

    return nextOperation
  }

  private resolveConversationLogPath(sessionId?: string | null): string {
    return CONVERSATION_SESSION_MANAGER.resolveConversationLogPath(
      sessionId || null
    )
  }

  private async createConversationLogFile(
    conversationLogPath: string
  ): Promise<void> {
    try {
      if (!fs.existsSync(conversationLogPath)) {
        await fs.promises.mkdir(path.dirname(conversationLogPath), {
          recursive: true
        })
        await fs.promises.writeFile(conversationLogPath, '[]', 'utf-8')
      }
    } catch (e) {
      LogHelper.title(this.settings.loggerName)
      LogHelper.error(`Failed to create conversation log file: ${e})`)
    }
  }

  private async getAllLogs(sessionId?: string | null): Promise<MessageLog[]> {
    try {
      let conversationLog: MessageLog[] = []
      const conversationLogPath = this.resolveConversationLogPath(sessionId)

      if (fs.existsSync(conversationLogPath)) {
        conversationLog = JSON.parse(
          await fs.promises.readFile(conversationLogPath, 'utf-8')
        )
      } else {
        await this.createConversationLogFile(conversationLogPath)
      }

      return conversationLog
    } catch (e) {
      LogHelper.title(this.settings.loggerName)
      LogHelper.error(`Failed to get conversation log: ${e})`)
    }

    return []
  }

  /**
   * Keep the conversation log readable while forcing widget payloads to stay
   * on one line in the JSON file.
   */
  private serializeLogs(conversationLogs: MessageLog[]): string {
    const serializedWidgets = new Map<string, string>()
    const serializedLLMMetrics = new Map<string, string>()
    const preparedLogs = conversationLogs.map((conversationLog, index) => {
      let widgetPlaceholder: string | null = null
      let llmMetricsPlaceholder: string | null = null
      const preparedConversationLog: MessageLog = {
        who: conversationLog.who,
        sentAt: conversationLog.sentAt,
        message: conversationLog.message,
        isAddedToHistory: conversationLog.isAddedToHistory,
        ...(conversationLog.messageId
          ? { messageId: conversationLog.messageId }
          : {})
      }

      if (conversationLog.widget) {
        widgetPlaceholder = `${ConversationLogger.WIDGET_PLACEHOLDER_PREFIX}_${index}`
        serializedWidgets.set(
          widgetPlaceholder,
          JSON.stringify(conversationLog.widget)
        )
      }

      if (conversationLog.llmMetrics) {
        llmMetricsPlaceholder = `${ConversationLogger.LLM_METRICS_PLACEHOLDER_PREFIX}_${index}`
        serializedLLMMetrics.set(
          llmMetricsPlaceholder,
          JSON.stringify(conversationLog.llmMetrics)
        )
      }

      return {
        ...preparedConversationLog,
        ...(widgetPlaceholder
          ? {
              widget:
                widgetPlaceholder as unknown as ConversationWidgetData | null
            }
          : {}),
        ...(llmMetricsPlaceholder
          ? {
              llmMetrics:
                llmMetricsPlaceholder as unknown as LLMAnswerMetrics
            }
          : {})
      }
    })

    let serializedLogs = JSON.stringify(preparedLogs, null, 2)

    for (const [placeholder, serializedWidget] of serializedWidgets.entries()) {
      serializedLogs = serializedLogs.replace(
        `"${placeholder}"`,
        serializedWidget
      )
    }

    for (const [placeholder, serializedMetrics] of serializedLLMMetrics.entries()) {
      serializedLogs = serializedLogs.replace(
        `"${placeholder}"`,
        serializedMetrics
      )
    }

    return serializedLogs
  }

  public async push(newRecord: Omit<MessageLog, 'sentAt'>): Promise<void> {
    await this.upsert(newRecord)
  }

  public async upsert(
    newRecord: Omit<MessageLog, 'sentAt'>,
    params?: UpsertParams
  ): Promise<void> {
    await this.enqueue(async () => {
      try {
        const conversationLogs = await this.getAllLogs(params?.sessionId)
        const targetMessageId =
          params?.replaceMessageId || newRecord.messageId || null

        if (targetMessageId) {
          const existingConversationLogIndex = conversationLogs.findIndex(
            (conversationLog) => conversationLog.messageId === targetMessageId
          )

          if (existingConversationLogIndex !== -1) {
            const existingConversationLog =
              conversationLogs[existingConversationLogIndex]

            if (existingConversationLog) {
              conversationLogs[existingConversationLogIndex] = {
                ...existingConversationLog,
                ...newRecord,
                messageId: targetMessageId,
                sentAt: params?.refreshSentAt
                  ? Date.now()
                  : existingConversationLog.sentAt
              }
            }
          } else {
            conversationLogs.push({
              ...newRecord,
              messageId: targetMessageId,
              sentAt: Date.now()
            })
          }
        } else {
          if (conversationLogs.length >= this.settings.nbOfLogsToKeep) {
            conversationLogs.shift()
          }

          conversationLogs.push({
            ...newRecord,
            sentAt: Date.now()
          })
        }

        if (conversationLogs.length > this.settings.nbOfLogsToKeep) {
          conversationLogs.splice(
            0,
            conversationLogs.length - this.settings.nbOfLogsToKeep
          )
        }

        await fs.promises.writeFile(
          this.resolveConversationLogPath(params?.sessionId),
          this.serializeLogs(conversationLogs),
          'utf-8'
        )
        CONVERSATION_SESSION_MANAGER.updateSessionFromLogs(
          params?.sessionId,
          conversationLogs
        )
      } catch (e) {
        LogHelper.title(this.settings.loggerName)
        LogHelper.error(`Failed to upsert record: ${e})`)
      }
    })
  }

  public async load(params?: LoadParams): Promise<MessageLog[]> {
    return this.enqueue(async () => {
      try {
        const conversationLog = await this.getAllLogs(params?.sessionId)
        const nbOfLogsToLoad =
          params?.nbOfLogsToLoad || this.settings.nbOfLogsToLoad

        return conversationLog.slice(-nbOfLogsToLoad)
      } catch (e) {
        LogHelper.title(this.settings.loggerName)
        LogHelper.error(`Failed to load conversation log: ${e})`)
      }

      return []
    })
  }

  public async loadAll(params?: { sessionId?: string }): Promise<MessageLog[]> {
    return this.enqueue(async () => {
      try {
        return await this.getAllLogs(params?.sessionId)
      } catch (e) {
        LogHelper.title(this.settings.loggerName)
        LogHelper.error(`Failed to load all conversation logs: ${e})`)
      }

      return []
    })
  }

  public async clear(params?: { sessionId?: string }): Promise<void> {
    await this.enqueue(async () => {
      try {
        await fs.promises.writeFile(
          this.resolveConversationLogPath(params?.sessionId),
          '[]',
          'utf-8'
        )
        CONVERSATION_SESSION_MANAGER.updateSessionFromLogs(params?.sessionId, [])
      } catch (e) {
        LogHelper.title(this.settings.loggerName)
        LogHelper.error(`Failed to clear conversation log: ${e})`)
      }
    })
  }
}
