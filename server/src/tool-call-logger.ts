import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'

import { PROFILE_LOGS_PATH } from '@/constants'
import { DateHelper } from '@/helpers/date-helper'
import { LogHelper } from '@/helpers/log-helper'

interface ToolCallLogEntry {
  toolName: string
  params: Record<string, unknown> | null
}

interface OwnerQueryToolCallRecord {
  ownerQuery: string
  toolCalls: ToolCallLogEntry[]
}

interface ToolCallLoggerSettings {
  loggerName: string
  fileName: string
  nbOfLogsToKeep: number
}

interface ToolOutputLogInput {
  toolkitId: string | null
  toolId: string
  functionName: string | null
  status: string
  message: string
  rawInput: string | null
  parsedInput: Record<string, unknown> | null
  output: Record<string, unknown>
}

const TOOL_OUTPUT_LOGS_DIR = path.join(PROFILE_LOGS_PATH, 'tool-outputs')
const TOOL_OUTPUT_LOG_RETENTION_MS = 12 * 60 * 60 * 1_000

export class ToolCallLogger {
  private readonly settings: ToolCallLoggerSettings
  private readonly toolCallLogPath: string
  private readonly activeQueryStore = new AsyncLocalStorage<string>()
  private readonly pendingRecords = new Map<string, OwnerQueryToolCallRecord>()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(settings: ToolCallLoggerSettings) {
    LogHelper.title(settings.loggerName)
    LogHelper.success('New instance')

    this.settings = settings
    this.toolCallLogPath = path.join(
      PROFILE_LOGS_PATH,
      this.settings.fileName
    )
    fs.mkdirSync(TOOL_OUTPUT_LOGS_DIR, { recursive: true })
    void this.cleanupToolOutputLogs()

    const cleanupInterval = setInterval(() => {
      void this.cleanupToolOutputLogs()
    }, TOOL_OUTPUT_LOG_RETENTION_MS)
    cleanupInterval.unref?.()
  }

  private async ensureLogFile(): Promise<void> {
    if (!fs.existsSync(this.toolCallLogPath)) {
      await fs.promises.writeFile(this.toolCallLogPath, '[]', 'utf-8')
    }
  }

  private async loadAll(): Promise<OwnerQueryToolCallRecord[]> {
    await this.ensureLogFile()

    const content = await fs.promises.readFile(this.toolCallLogPath, 'utf-8')
    const parsed = JSON.parse(content)

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed as OwnerQueryToolCallRecord[]
  }

  private async persistRecord(record: OwnerQueryToolCallRecord): Promise<void> {
    const existingRecords = await this.loadAll()

    existingRecords.push(record)

    const trimmedRecords = existingRecords.slice(
      -this.settings.nbOfLogsToKeep
    )

    await fs.promises.writeFile(
      this.toolCallLogPath,
      JSON.stringify(trimmedRecords, null, 2),
      'utf-8'
    )
  }

  private queuePersist(record: OwnerQueryToolCallRecord): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(() => this.persistRecord(record))
      .catch((error) => {
        LogHelper.title(this.settings.loggerName)
        LogHelper.error(`Failed to persist tool call record: ${error}`)
      })

    return this.writeQueue
  }

  private serializeLogValue(value: unknown): string {
    if (typeof value === 'string') {
      return value
    }

    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  private sanitizeFilenamePart(value: string | null | undefined): string {
    const normalized = String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')

    return normalized || 'unknown'
  }

  private buildToolOutputLogPrefix(dateTime: string): string {
    const [datePart = '', timePartWithZone = ''] = dateTime.split('T')
    const timePart = timePartWithZone.slice(0, 8)

    return `${datePart.replaceAll('-', '')}_${timePart.replaceAll(':', '')}`
  }

  private async buildToolOutputLogPath(params: {
    dateTime: string
    toolId: string
    functionName: string | null
  }): Promise<string> {
    const prefix = this.buildToolOutputLogPrefix(params.dateTime)
    const toolId = this.sanitizeFilenamePart(params.toolId)
    const functionName = this.sanitizeFilenamePart(params.functionName)
    const baseFilename = `${prefix}_${toolId}_${functionName}`
    let candidatePath = path.join(TOOL_OUTPUT_LOGS_DIR, `${baseFilename}.log`)
    let counter = 1

    while (fs.existsSync(candidatePath)) {
      candidatePath = path.join(
        TOOL_OUTPUT_LOGS_DIR,
        `${baseFilename}_${counter}.log`
      )
      counter += 1
    }

    return candidatePath
  }

  private async persistToolOutputLog(input: ToolOutputLogInput): Promise<void> {
    const dateTime = DateHelper.getDateTime()
    const filePath = await this.buildToolOutputLogPath({
      dateTime,
      toolId: input.toolId,
      functionName: input.functionName
    })
    const lines = [
      dateTime,
      `Status: ${input.status}`,
      `Message: ${input.message}`,
      `Toolkit ID: ${input.toolkitId || 'null'}`,
      `Tool ID: ${input.toolId}`,
      `Function Name: ${input.functionName || 'null'}`,
      '',
      'Input:',
      this.serializeLogValue(input.rawInput),
      '',
      'Parsed Input:',
      this.serializeLogValue(input.parsedInput),
      '',
      'Output:',
      this.serializeLogValue(input.output)
    ]

    await fs.promises.writeFile(filePath, `${lines.join('\n')}\n`, 'utf-8')
  }

  private queueToolOutputPersist(input: ToolOutputLogInput): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(() => this.persistToolOutputLog(input))
      .catch((error) => {
        LogHelper.title(this.settings.loggerName)
        LogHelper.error(`Failed to persist tool output log: ${error}`)
      })

    return this.writeQueue
  }

  public async runOwnerQuery<T>(
    ownerQuery: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const queryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    this.pendingRecords.set(queryId, {
      ownerQuery,
      toolCalls: []
    })

    try {
      return await this.activeQueryStore.run(queryId, fn)
    } finally {
      const record = this.pendingRecords.get(queryId)
      this.pendingRecords.delete(queryId)

      if (record) {
        await this.queuePersist(record)
      }
    }
  }

  public recordToolCall(input: {
    toolkitId: string
    toolId: string
    functionName: string
    params: Record<string, unknown> | null
  }): void {
    const queryId = this.activeQueryStore.getStore()
    if (!queryId) {
      return
    }

    const record = this.pendingRecords.get(queryId)
    if (!record) {
      return
    }

    record.toolCalls.push({
      toolName: `${input.toolkitId}.${input.toolId}.${input.functionName}`,
      params: input.params
    })
  }

  public async recordToolOutput(input: ToolOutputLogInput): Promise<void> {
    await this.queueToolOutputPersist(input)
  }

  public async cleanupToolOutputLogs(): Promise<void> {
    try {
      const entries = await fs.promises.readdir(TOOL_OUTPUT_LOGS_DIR, {
        withFileTypes: true
      })
      const now = Date.now()

      for (const entry of entries) {
        if (!entry.isFile() || path.extname(entry.name) !== '.log') {
          continue
        }

        const filePath = path.join(TOOL_OUTPUT_LOGS_DIR, entry.name)
        const stats = await fs.promises.stat(filePath)
        if (now - stats.mtimeMs < TOOL_OUTPUT_LOG_RETENTION_MS) {
          continue
        }

        await fs.promises.unlink(filePath)
      }
    } catch (error) {
      LogHelper.title(this.settings.loggerName)
      LogHelper.error(`Failed to clean tool output logs: ${error}`)
    }
  }
}
