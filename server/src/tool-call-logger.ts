import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'

import { DateHelper } from '@/helpers/date-helper'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'

export interface ToolCallLogEntry {
  toolName: string
  params: Record<string, unknown> | null
  status?: string
  message?: string
  outputLogPath?: string
  outputPreview?: string
}

export interface OwnerQueryToolCallRecord {
  ownerQuery: string
  sessionId?: string | null
  createdAt?: number
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

const TOOL_OUTPUT_LOG_RETENTION_MS = 12 * 60 * 60 * 1_000
const TOOL_OUTPUT_PREVIEW_MAX_LENGTH = 700
const RECENT_ARTIFACT_RECORDS_LIMIT = 4
export const RECENT_ARTIFACT_MANIFEST_MAX_CHARS = 6_000
const RECENT_ARTIFACT_MANIFEST_TOOL_CALLS_LIMIT = 16
const RECENT_ARTIFACT_MANIFEST_PREVIEW_MAX_CHARS = 160
const ARTIFACT_MANIFEST_OMISSION_NOTICE =
  '- Additional earlier artifacts were omitted. Use the known artifact paths or ask for a narrower earlier result if needed.'

function clipManifestText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(maxLength - 3, 0)).trimEnd()}...`
}

/** Builds a newest-first artifact manifest with one global input-size bound. */
export function buildRecentArtifactManifest(
  records: OwnerQueryToolCallRecord[],
  maxChars = RECENT_ARTIFACT_MANIFEST_MAX_CHARS
): string {
  const availableToolCallCount = records.reduce(
    (total, record) =>
      total +
      record.toolCalls.filter((toolCall) => toolCall.outputLogPath).length,
    0
  )
  let manifest = ''
  let includedToolCallCount = 0

  const append = (value: string): boolean => {
    const separator = manifest ? '\n' : ''
    if (manifest.length + separator.length + value.length > maxChars) {
      return false
    }

    manifest += `${separator}${value}`
    return true
  }
  const appendOmissionNotice = (): void => {
    if (includedToolCallCount >= availableToolCallCount) {
      return
    }

    if (append(ARTIFACT_MANIFEST_OMISSION_NOTICE)) {
      return
    }

    const manifestLines = manifest.split('\n')
    while (manifestLines.length > 0) {
      manifestLines.pop()
      manifest = manifestLines.join('\n')
      if (append(ARTIFACT_MANIFEST_OMISSION_NOTICE)) {
        return
      }
    }
  }

  for (const record of [...records].reverse()) {
    const artifactCalls = record.toolCalls
      .filter((toolCall) => toolCall.outputLogPath)
      .reverse()
    if (artifactCalls.length === 0) {
      continue
    }

    const createdAt = record.createdAt
      ? new Date(record.createdAt).toISOString()
      : 'unknown'
    const header = `ownerQuery="${clipManifestText(record.ownerQuery, 160)}" createdAt=${createdAt}`
    let hasAppendedRecordHeader = false

    for (const toolCall of artifactCalls) {
      if (
        includedToolCallCount >=
        RECENT_ARTIFACT_MANIFEST_TOOL_CALLS_LIMIT
      ) {
        appendOmissionNotice()
        return manifest
      }

      const queryParam = toolCall.params?.['query']
      const query =
        typeof queryParam === 'string'
          ? ` query="${clipManifestText(queryParam, 120)}"`
          : ''
      const preview = toolCall.outputPreview
        ? ` preview="${clipManifestText(toolCall.outputPreview, RECENT_ARTIFACT_MANIFEST_PREVIEW_MAX_CHARS)}"`
        : ''
      const line = `  - ${toolCall.toolName} status=${toolCall.status || 'unknown'}${query} outputLogPath=${toolCall.outputLogPath}${preview}`
      const entry = hasAppendedRecordHeader ? line : `${header}\n${line}`
      if (!append(entry)) {
        appendOmissionNotice()
        return manifest
      }

      hasAppendedRecordHeader = true
      includedToolCallCount += 1
    }
  }

  return manifest
}

export class ToolCallLogger {
  private readonly settings: ToolCallLoggerSettings
  private readonly toolCallLogPath: string
  private readonly toolOutputLogsDir: string
  private readonly activeQueryStore = new AsyncLocalStorage<string>()
  private readonly pendingRecords = new Map<string, OwnerQueryToolCallRecord>()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(settings: ToolCallLoggerSettings) {
    LogHelper.title(settings.loggerName)
    LogHelper.success('New instance')

    this.settings = settings
    const profileLogsPath = getProfilePaths().logs

    this.toolCallLogPath = path.join(
      profileLogsPath,
      this.settings.fileName
    )
    this.toolOutputLogsDir = path.join(profileLogsPath, 'tool-outputs')
    fs.mkdirSync(this.toolOutputLogsDir, { recursive: true })
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
      return StringHelper.redactSecrets(value)
    }

    try {
      return StringHelper.redactSecrets(JSON.stringify(value, null, 2))
    } catch {
      return StringHelper.redactSecrets(String(value))
    }
  }

  private redactLogRecordValue<T>(value: T): T {
    if (value === null || value === undefined) {
      return value
    }

    try {
      return JSON.parse(
        StringHelper.redactSecrets(JSON.stringify(value))
      ) as T
    } catch {
      return value
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
    let candidatePath = path.join(this.toolOutputLogsDir, `${baseFilename}.log`)
    let counter = 1

    while (fs.existsSync(candidatePath)) {
      candidatePath = path.join(
        this.toolOutputLogsDir,
        `${baseFilename}_${counter}.log`
      )
      counter += 1
    }

    return candidatePath
  }

  private clipText(value: string, maxLength: number): string {
    return clipManifestText(value, maxLength)
  }

  private buildOutputPreview(output: Record<string, unknown>): string {
    const candidateKeys = [
      'result',
      'stdout',
      'runtime_stdout',
      'stderr',
      'runtime_stderr'
    ]

    for (const key of candidateKeys) {
      const value = output[key]

      if (value === undefined || value === null) {
        continue
      }

      const serialized = this.serializeLogValue(value)

      if (serialized.trim()) {
        return this.clipText(serialized, TOOL_OUTPUT_PREVIEW_MAX_LENGTH)
      }
    }

    return this.clipText(
      this.serializeLogValue(output),
      TOOL_OUTPUT_PREVIEW_MAX_LENGTH
    )
  }

  private async persistToolOutputLog(input: ToolOutputLogInput): Promise<string> {
    const dateTime = DateHelper.getDateTime()
    const filePath = await this.buildToolOutputLogPath({
      dateTime,
      toolId: input.toolId,
      functionName: input.functionName
    })
    const lines = [
      dateTime,
      `Status: ${input.status}`,
      `Message: ${StringHelper.redactSecrets(input.message)}`,
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

    return filePath
  }

  private queueToolOutputPersist(
    input: ToolOutputLogInput
  ): Promise<string | null> {
    const nextWrite = this.writeQueue.then(() =>
      this.persistToolOutputLog(input)
    )

    this.writeQueue = nextWrite
      .then(() => undefined)
      .catch((error) => {
        LogHelper.title(this.settings.loggerName)
        LogHelper.error(`Failed to persist tool output log: ${error}`)
      })

    return nextWrite.catch(() => null)
  }

  private getToolName(input: {
    toolkitId: string | null
    toolId: string
    functionName: string | null
  }): string {
    return `${input.toolkitId || 'null'}.${input.toolId}.${input.functionName || 'null'}`
  }

  private attachToolOutputToActiveRecord(
    input: ToolOutputLogInput,
    outputLogPath: string
  ): void {
    const queryId = this.activeQueryStore.getStore()

    if (!queryId) {
      return
    }

    const record = this.pendingRecords.get(queryId)

    if (!record) {
      return
    }

    const toolName = this.getToolName(input)
    const target = [...record.toolCalls]
      .reverse()
      .find((toolCall) => toolCall.toolName === toolName && !toolCall.outputLogPath)

    if (!target) {
      return
    }

    target.status = input.status
    target.message = StringHelper.redactSecrets(input.message)
    target.outputLogPath = outputLogPath
    target.outputPreview = this.buildOutputPreview(input.output)
  }

  public async runOwnerQuery<T>(
    ownerQuery: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const queryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    this.pendingRecords.set(queryId, {
      ownerQuery: StringHelper.redactSecrets(ownerQuery),
      sessionId: getActiveConversationSessionId(),
      createdAt: Date.now(),
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
      params: this.redactLogRecordValue(input.params)
    })
  }

  public async recordToolOutput(
    input: ToolOutputLogInput
  ): Promise<string | null> {
    const outputLogPath = await this.queueToolOutputPersist(input)

    if (outputLogPath) {
      this.attachToolOutputToActiveRecord(input, outputLogPath)
    }

    return outputLogPath
  }

  public async getRecentArtifactManifest(): Promise<string> {
    const activeSessionId = getActiveConversationSessionId()
    const records = await this.loadAll()
    const matchingRecords = records
      .filter((record) => {
        if (!record.toolCalls.some((toolCall) => toolCall.outputLogPath)) {
          return false
        }

        return !activeSessionId || !record.sessionId || record.sessionId === activeSessionId
      })
      .slice(-RECENT_ARTIFACT_RECORDS_LIMIT)

    if (matchingRecords.length === 0) {
      return ''
    }

    return buildRecentArtifactManifest(matchingRecords)
  }

  public async cleanupToolOutputLogs(): Promise<void> {
    try {
      const entries = await fs.promises.readdir(this.toolOutputLogsDir, {
        withFileTypes: true
      })
      const now = Date.now()

      for (const entry of entries) {
        if (!entry.isFile() || path.extname(entry.name) !== '.log') {
          continue
        }

        const filePath = path.join(this.toolOutputLogsDir, entry.name)
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
