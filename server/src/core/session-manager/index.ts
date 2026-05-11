import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import type { MessageLog } from '@/types'
import {
  PROFILE_CONVERSATION_LOG_PATH,
  PROFILE_SESSIONS_INDEX_PATH,
  PROFILE_SESSIONS_PATH
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import {
  getActiveConversationSessionId,
  runWithConversationSession
} from '@/core/session-manager/session-context'

const SESSION_CONVERSATION_LOG_FILENAME = 'conversation_log.json'
const DEFAULT_SESSION_TITLE = 'New session'
const MIGRATED_SESSION_TITLE = 'Previous conversation'
const TITLE_MAX_LENGTH = 64
const TITLE_FALLBACK_WORD_LIMIT = 8
const WHITESPACE_PATTERN = /\s+/
const SESSION_TITLE_SYSTEM_PROMPT =
  'Create a concise conversation title. Use 2 to 6 words. Return only the title, without quotes or punctuation at the end.'

export interface ConversationSession {
  id: string
  title: string
  isTitleGenerated: boolean
  isPinned: boolean
  createdAt: number
  updatedAt: number
  lastMessageAt: number | null
  messageCount: number
  modelTarget: string | null
}

interface ConversationSessionIndex {
  activeSessionId: string
  sessions: ConversationSession[]
}

interface SessionUpdateInput {
  title?: string
  isPinned?: boolean
  modelTarget?: string | null
}

function now(): number {
  return Date.now()
}

function cloneSession(session: ConversationSession): ConversationSession {
  return {
    ...session
  }
}

function normalizeTitle(title: string): string {
  return title.trim().replaceAll('\n', ' ').slice(0, TITLE_MAX_LENGTH).trim()
}

function normalizeModelTarget(modelTarget: string): string {
  return modelTarget.trim().replaceAll('\n', ' ')
}

function createFallbackTitle(message: string): string {
  const words = message
    .trim()
    .split(WHITESPACE_PATTERN)
    .filter(Boolean)
    .slice(0, TITLE_FALLBACK_WORD_LIMIT)
    .join(' ')

  return normalizeTitle(words) || DEFAULT_SESSION_TITLE
}

function createSession(title = DEFAULT_SESSION_TITLE): ConversationSession {
  const createdAt = now()

  return {
    id: randomUUID(),
    title,
    isTitleGenerated: title !== DEFAULT_SESSION_TITLE,
    isPinned: false,
    createdAt,
    updatedAt: createdAt,
    lastMessageAt: null,
    messageCount: 0,
    modelTarget: null
  }
}

export class ConversationSessionManager {
  public readonly events = new EventEmitter()
  private index: ConversationSessionIndex | null = null

  public ensureReady(): ConversationSessionIndex {
    if (this.index) {
      return this.index
    }

    this.index = this.loadOrCreateIndex()
    this.persistIndex()

    return this.index
  }

  public listSessions(): ConversationSession[] {
    return this.ensureReady().sessions.map(cloneSession)
  }

  public getActiveSessionId(): string {
    return this.ensureReady().activeSessionId
  }

  public getCurrentSessionId(): string {
    return getActiveConversationSessionId() || this.getActiveSessionId()
  }

  public getSession(sessionId: string): ConversationSession | null {
    return this.findSession(sessionId)
  }

  public createSession(): ConversationSession {
    const index = this.ensureReady()
    const session = createSession()

    index.sessions.unshift(session)
    index.activeSessionId = session.id
    this.ensureSessionDirectory(session.id)
    this.persistIndex()
    this.emitUpdated()

    return cloneSession(session)
  }

  public updateSession(
    sessionId: string,
    input: SessionUpdateInput
  ): ConversationSession {
    const session = this.requireSession(sessionId)

    if (typeof input.title === 'string') {
      const nextTitle = normalizeTitle(input.title)

      if (nextTitle) {
        session.title = nextTitle
        session.isTitleGenerated = true
      }
    }

    if (typeof input.isPinned === 'boolean') {
      session.isPinned = input.isPinned
    }

    if ('modelTarget' in input) {
      session.modelTarget = input.modelTarget
        ? normalizeModelTarget(input.modelTarget)
        : null
    }

    session.updatedAt = now()
    this.persistIndex()
    this.emitUpdated()

    return cloneSession(session)
  }

  public async setSessionModelFromProvider(
    sessionId: string,
    provider: string,
    model: string
  ): Promise<ConversationSession> {
    const { CONFIG_STATE } = await import('@/core/config-states/config-state')
    const modelState = CONFIG_STATE.getModelState()

    if (!modelState.isSupportedProvider(provider)) {
      throw new Error(`The provider "${provider}" is not supported.`)
    }

    const modelTarget = modelState.createConfiguredTargetValue(provider, model)

    return this.updateSession(sessionId, {
      modelTarget
    })
  }

  public deleteSession(sessionId: string): ConversationSession {
    const index = this.ensureReady()
    const sessionIndex = index.sessions.findIndex(
      (session) => session.id === sessionId
    )

    if (sessionIndex === -1) {
      throw new Error(`The session "${sessionId}" does not exist.`)
    }

    const [deletedSession] = index.sessions.splice(sessionIndex, 1)

    if (!deletedSession) {
      throw new Error(`The session "${sessionId}" does not exist.`)
    }

    if (index.sessions.length === 0) {
      index.sessions.push(createSession())
    }

    if (index.activeSessionId === sessionId) {
      index.activeSessionId = index.sessions[0]!.id
    }

    fs.rmSync(this.getSessionPath(sessionId), {
      recursive: true,
      force: true
    })
    this.persistIndex()
    this.emitUpdated()

    return cloneSession(deletedSession)
  }

  public setActiveSession(sessionId: string): ConversationSession {
    const session = this.requireSession(sessionId)

    this.ensureReady().activeSessionId = session.id
    this.persistIndex()
    this.emitUpdated()

    return cloneSession(session)
  }

  public resolveConversationLogPath(sessionId?: string | null): string {
    const resolvedSessionId =
      sessionId || getActiveConversationSessionId() || this.getActiveSessionId()
    const session = this.requireSession(resolvedSessionId)
    const sessionPath = this.getSessionPath(session.id)

    this.ensureSessionDirectory(session.id)

    return path.join(sessionPath, SESSION_CONVERSATION_LOG_FILENAME)
  }

  public updateSessionFromLogs(
    sessionId: string | null | undefined,
    logs: MessageLog[]
  ): void {
    const resolvedSessionId =
      sessionId || getActiveConversationSessionId() || this.getActiveSessionId()
    const session = this.requireSession(resolvedSessionId)
    const historyLogs = logs.filter((log) => log.isAddedToHistory === true)
    const lastLog = historyLogs[historyLogs.length - 1]
    const updatedAt = now()

    session.messageCount = historyLogs.length
    session.lastMessageAt =
      typeof lastLog?.sentAt === 'number' ? lastLog.sentAt : session.lastMessageAt
    session.updatedAt = updatedAt
    this.persistIndex()
    this.emitUpdated()
  }

  public maybeSetFallbackTitle(sessionId: string, message: string): void {
    const session = this.requireSession(sessionId)

    if (session.isTitleGenerated || session.messageCount > 1) {
      return
    }

    session.title = createFallbackTitle(message)
    session.updatedAt = now()
    this.persistIndex()
    this.emitUpdated()
  }

  public generateTitleFromFirstMessage(sessionId: string, message: string): void {
    void this.generateTitle(sessionId, message).catch((error: unknown) => {
      LogHelper.title('Session Manager')
      LogHelper.warning(`Failed to generate session title: ${error}`)
    })
  }

  public runWithSession<T>(sessionId: string, callback: () => T): T {
    const session = this.requireSession(sessionId)

    return runWithConversationSession(
      {
        sessionId: session.id,
        modelTarget: session.modelTarget
      },
      callback
    )
  }

  private async generateTitle(
    sessionId: string,
    message: string
  ): Promise<void> {
    const session = this.requireSession(sessionId)

    if (session.isTitleGenerated || session.messageCount > 1) {
      return
    }

    const { LLM_PROVIDER } = await import('@/core')
    const { LLMDuties } = await import('@/core/llm-manager/types')
    const titleResult = await this.runWithSession(sessionId, () =>
      LLM_PROVIDER.prompt(message, {
        dutyType: LLMDuties.Inference,
        systemPrompt: SESSION_TITLE_SYSTEM_PROMPT,
        maxTokens: 24,
        temperature: 0.2,
        shouldStream: false,
        trackProviderErrors: false
      })
    )
    const title = normalizeTitle(String(titleResult?.output || ''))

    if (!title) {
      return
    }

    session.title = title
    session.isTitleGenerated = true
    session.updatedAt = now()
    this.persistIndex()
    this.emitUpdated()
  }

  private loadOrCreateIndex(): ConversationSessionIndex {
    if (fs.existsSync(PROFILE_SESSIONS_INDEX_PATH)) {
      try {
        const index = JSON.parse(
          fs.readFileSync(PROFILE_SESSIONS_INDEX_PATH, 'utf-8')
        ) as ConversationSessionIndex

        if (Array.isArray(index.sessions) && index.sessions.length > 0) {
          return this.normalizeIndex(index)
        }
      } catch (error) {
        LogHelper.title('Session Manager')
        LogHelper.warning(`Failed to load sessions index: ${error}`)
      }
    }

    return this.createInitialIndex()
  }

  private createInitialIndex(): ConversationSessionIndex {
    const legacyLogs = this.readLegacyConversationLogs()
    const session = createSession(
      legacyLogs.length > 0 ? MIGRATED_SESSION_TITLE : DEFAULT_SESSION_TITLE
    )

    session.messageCount = legacyLogs.filter(
      (log) => log.isAddedToHistory === true
    ).length
    session.lastMessageAt =
      legacyLogs.length > 0
        ? legacyLogs[legacyLogs.length - 1]?.sentAt || session.createdAt
        : null
    session.updatedAt = session.lastMessageAt || session.createdAt

    this.ensureSessionDirectory(session.id)

    if (legacyLogs.length > 0) {
      fs.writeFileSync(
        path.join(this.getSessionPath(session.id), SESSION_CONVERSATION_LOG_FILENAME),
        JSON.stringify(legacyLogs, null, 2),
        'utf-8'
      )
    }

    return {
      activeSessionId: session.id,
      sessions: [session]
    }
  }

  private normalizeIndex(index: ConversationSessionIndex): ConversationSessionIndex {
    const sessions = index.sessions.map((session) => ({
      id: session.id,
      title: normalizeTitle(session.title || DEFAULT_SESSION_TITLE),
      isTitleGenerated: session.isTitleGenerated === true,
      isPinned: session.isPinned === true,
      createdAt: typeof session.createdAt === 'number' ? session.createdAt : now(),
      updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : now(),
      lastMessageAt:
        typeof session.lastMessageAt === 'number' ? session.lastMessageAt : null,
      messageCount:
        typeof session.messageCount === 'number' ? session.messageCount : 0,
      modelTarget:
        typeof session.modelTarget === 'string' && session.modelTarget.trim()
          ? session.modelTarget.trim()
          : null
    }))

    const activeSessionId = sessions.some(
      (session) => session.id === index.activeSessionId
    )
      ? index.activeSessionId
      : sessions[0]!.id

    return {
      activeSessionId,
      sessions
    }
  }

  private readLegacyConversationLogs(): MessageLog[] {
    if (!fs.existsSync(PROFILE_CONVERSATION_LOG_PATH)) {
      return []
    }

    try {
      const logs = JSON.parse(
        fs.readFileSync(PROFILE_CONVERSATION_LOG_PATH, 'utf-8')
      ) as MessageLog[]

      return Array.isArray(logs) ? logs : []
    } catch {
      return []
    }
  }

  private findSession(sessionId: string): ConversationSession | null {
    return (
      this.ensureReady().sessions.find((session) => session.id === sessionId) ||
      null
    )
  }

  private requireSession(sessionId: string): ConversationSession {
    const session = this.findSession(sessionId)

    if (!session) {
      throw new Error(`The session "${sessionId}" does not exist.`)
    }

    return session
  }

  private getSessionPath(sessionId: string): string {
    return path.join(PROFILE_SESSIONS_PATH, sessionId)
  }

  private ensureSessionDirectory(sessionId: string): void {
    fs.mkdirSync(this.getSessionPath(sessionId), { recursive: true })
  }

  private persistIndex(): void {
    if (!this.index) {
      return
    }

    fs.mkdirSync(PROFILE_SESSIONS_PATH, { recursive: true })
    fs.writeFileSync(
      PROFILE_SESSIONS_INDEX_PATH,
      `${JSON.stringify(this.index, null, 2)}\n`,
      'utf-8'
    )
  }

  private emitUpdated(): void {
    this.events.emit('updated', {
      activeSessionId: this.getActiveSessionId(),
      sessions: this.listSessions()
    })
  }
}

export const CONVERSATION_SESSION_MANAGER = new ConversationSessionManager()
