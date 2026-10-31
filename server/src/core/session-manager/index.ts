import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import type { MessageLog } from '@/types'
import type { LLMModelSettings } from '@/core/config-states/model-settings-state'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { LogHelper } from '@/helpers/log-helper'
import {
  LLMDuties,
  InferencePurpose,
  LLMProviders,
  type CompletionParams,
  type AgentToolTranscriptMessage
} from '@/core/llm-manager/types'
import {
  getActiveConversationSessionId,
  runWithConversationSession
} from '@/core/session-manager/session-context'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { CONVERSATION_REPOSITORY } from './conversation-repository'

const SESSION_CONVERSATION_LOG_FILENAME = 'conversation_log.json'
const DEFAULT_SESSION_TITLE = 'New session'
const MIGRATED_SESSION_TITLE = 'Previous conversation'
const TITLE_MAX_LENGTH = 64
const TITLE_FALLBACK_WORD_LIMIT = 8
const SESSION_TITLE_MAX_TOKENS = 64
const SESSION_TITLE_TIMEOUT_MS = 15_000
const SESSION_TITLE_MAX_RETRIES = 0
const WHITESPACE_PATTERN = /\s+/
const TITLE_THINKING_TAG_NAMES = ['analysis', 'think', 'thinking', 'thought']
const TITLE_LEADING_CHANNEL_PATTERN = /^<\|?channel\|?>\s*([a-z_]+)?\s*/i
const TITLE_CHANNEL_END_TAG = '<channel|>'
const SESSION_TITLE_SYSTEM_PROMPT =
  'Create a concise conversation title. Use 2 to 6 words. Return only the title, without quotes or punctuation at the end.'
const TITLE_DISABLE_THINKING_PROVIDERS = [
  LLMProviders.LlamaCPP,
  LLMProviders.SGLang
] as const
const TITLE_REASONING_MODE_OFF_PROVIDERS = [
  LLMProviders.OpenAI,
  LLMProviders.OpenRouter,
  LLMProviders.ZAI,
  LLMProviders.DeepSeek,
  LLMProviders.MiniMax,
  LLMProviders.Anthropic,
  LLMProviders.MoonshotAI,
  LLMProviders.HuggingFace,
  LLMProviders.Cerebras,
  LLMProviders.Groq
] as const

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
  modelSettings?: Record<string, Partial<LLMModelSettings>>
}

interface ConversationSessionIndex {
  activeSessionId: string
  sessions: ConversationSession[]
}

interface SessionUpdateInput {
  title?: string
  isPinned?: boolean
  modelTarget?: string | null
  modelSettings?: Record<string, Partial<LLMModelSettings>>
}

interface PendingAgentMessage {
  prepare: () => Promise<AgentToolTranscriptMessage>
  resolve: (consumed: boolean) => void
  reject: (error: unknown) => void
}

function now(): number {
  return Date.now()
}

function cloneSession(session: ConversationSession): ConversationSession {
  return {
    ...session,
    ...(session.modelSettings ? { modelSettings: structuredClone(session.modelSettings) } : {})
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

function stripLeadingTitleTemplateTags(title: string): string {
  const trimmedTitle = title.trim()
  const leadingChannelMatch = trimmedTitle.match(TITLE_LEADING_CHANNEL_PATTERN)

  if (leadingChannelMatch) {
    const channelLabel = (leadingChannelMatch[1] || '').toLowerCase()

    if (channelLabel === 'final') {
      return trimmedTitle.slice(leadingChannelMatch[0].length).trimStart()
    }

    const channelEndIndex = trimmedTitle
      .toLowerCase()
      .indexOf(TITLE_CHANNEL_END_TAG)

    return channelEndIndex === -1
      ? ''
      : trimmedTitle
          .slice(channelEndIndex + TITLE_CHANNEL_END_TAG.length)
          .trimStart()
  }

  const lowerTitle = trimmedTitle.toLowerCase()

  for (const tagName of TITLE_THINKING_TAG_NAMES) {
    const openingTag = `<${tagName}>`

    if (!lowerTitle.startsWith(openingTag)) {
      continue
    }

    const closingTag = `</${tagName}>`
    const closingTagIndex = lowerTitle.indexOf(closingTag)

    return closingTagIndex === -1
      ? ''
      : trimmedTitle
          .slice(closingTagIndex + closingTag.length)
          .trimStart()
  }

  return trimmedTitle
}

function getTitleReasoningParams(
  provider: LLMProviders
): Pick<CompletionParams, 'disableThinking' | 'reasoningMode'> {
  if (TITLE_DISABLE_THINKING_PROVIDERS.includes(
    provider as (typeof TITLE_DISABLE_THINKING_PROVIDERS)[number]
  )) {
    return { disableThinking: true }
  }

  if (TITLE_REASONING_MODE_OFF_PROVIDERS.includes(
    provider as (typeof TITLE_REASONING_MODE_OFF_PROVIDERS)[number]
  )) {
    return { reasoningMode: 'off' }
  }

  return {}
}

function createSession(title = DEFAULT_SESSION_TITLE, id: string = randomUUID()): ConversationSession {
  const createdAt = now()

  return {
    id,
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
  private readonly sessionQueues = new Map<string, Promise<void>>()
  private readonly agentMessageQueues = new Map<string, {
    pending: PendingAgentMessage[]
    controller: AbortController
    executionController: AbortController
  }>()

  /**
   * Interrupts stale execution so the active agent can apply owner messages.
   * Explicit cancellation also ends retained executions from the same turn.
   * Unconsumed messages return to ordinary session processing when the run ends.
   */
  public openAgentTurn(sessionId: string): {
    signal: AbortSignal
    drainOwnerMessages: () => Promise<AgentToolTranscriptMessage[]>
    getOwnerMessageSignal: () => AbortSignal
    cancelExecutions: () => void
    close: () => void
  } {
    if (this.agentMessageQueues.has(sessionId)) {
      throw new Error('An agent turn is already active in this session.')
    }

    const pending: PendingAgentMessage[] = []
    const executionController = new AbortController()
    const turn = { pending, controller: new AbortController(), executionController }
    this.agentMessageQueues.set(sessionId, turn)

    return {
      signal: executionController.signal,
      // Retained executions may outlive the message revision that started them.
      cancelExecutions: (): void => {
        executionController.abort(new Error('Task canceled by the owner.'))
      },
      getOwnerMessageSignal: (): AbortSignal => turn.controller.signal,
      drainOwnerMessages: async (): Promise<AgentToolTranscriptMessage[]> => {
        const messages: AgentToolTranscriptMessage[] = []

        while (pending.length > 0) {
          const entry = pending.shift()!

          try {
            messages.push(await entry.prepare())
            entry.resolve(true)
          } catch (error) {
            // Invalid incoming messages fail their sender without ending the agent.
            entry.reject(error)
          }
        }

        // Each reassessment gets a fresh signal after all queued input is applied.
        if (turn.controller.signal.aborted) {
          turn.controller = new AbortController()
        }

        return messages
      },
      close: (): void => {
        if (this.agentMessageQueues.get(sessionId) !== turn) {
          return
        }

        this.agentMessageQueues.delete(sessionId)

        for (const entry of pending.splice(0)) {
          entry.resolve(false)
        }
      }
    }
  }

  /**
   * Queues a message for the current agent, or leaves it to normal turn routing.
   */
  public queueAgentMessage(
    sessionId: string,
    prepare: () => Promise<AgentToolTranscriptMessage>
  ): Promise<boolean> | null {
    const turn = this.agentMessageQueues.get(sessionId)

    if (!turn) {
      return null
    }

    return new Promise((resolve, reject) => {
      turn.pending.push({ prepare, resolve, reject })
      // Stop stale inference and running tools before choosing the next action.
      turn.controller.abort(new Error('New owner instructions require reassessment.'))
    })
  }

  /**
   * Keeps live typing active while follow-up messages join an agent turn.
   */
  public isAgentTurnActive(sessionId: string): boolean {
    return this.agentMessageQueues.has(sessionId)
  }

  /**
   * Cancels only the addressed session, including retained tool executions.
   */
  public cancelAgentTurn(sessionId: string): void {
    const turn = this.agentMessageQueues.get(sessionId)
    turn?.executionController.abort(new Error('Stopped by the owner.'))
    turn?.controller.abort(new Error('Stopped by the owner.'))
  }

  public ensureReady(): ConversationSessionIndex {
    if (this.index) {
      return this.index
    }

    this.index = this.loadOrCreateIndex()
    CONVERSATION_REPOSITORY.saveActiveSession(this.index.activeSessionId)

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

  public createSession(sessionId?: string): ConversationSession {
    const index = this.ensureReady()
    const existing = sessionId ? this.findSession(sessionId) : null
    if (existing) {
      return cloneSession(existing)
    }
    const session = createSession(DEFAULT_SESSION_TITLE, sessionId)

    index.sessions.unshift(session)
    index.activeSessionId = session.id
    this.ensureSessionDirectory(session.id)
    this.persistIndex(session)
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

    if (input.modelSettings) {
      session.modelSettings = structuredClone(input.modelSettings)
    }

    session.updatedAt = now()
    this.persistIndex(session)
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
    if (this.isAgentTurnActive(sessionId)) {
      throw new Error('Stop this session’s active turn before deleting it.')
    }

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

    const replacement = index.sessions.length === 0 ? createSession() : undefined
    if (replacement) {
      index.sessions.push(replacement)
    }

    if (index.activeSessionId === sessionId) {
      index.activeSessionId = index.sessions[0]!.id
    }

    CONVERSATION_REPOSITORY.deleteSession(sessionId)
    fs.rmSync(this.getSessionPath(sessionId), {
      recursive: true,
      force: true
    })
    this.persistIndex(replacement)
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
    this.persistIndex(session)
    this.emitUpdated()
  }

  /**
   * Updates sidebar metadata without loading a conversation's message bodies.
   */
  public updateSessionFromStoredMessages(sessionId: string): void {
    const session = this.requireSession(sessionId)
    const stored = CONVERSATION_REPOSITORY.readSession(sessionId)

    if (!stored) {
      throw new Error('The conversation session no longer exists.')
    }

    if (JSON.stringify(session) === JSON.stringify(stored)) {
      return
    }

    Object.assign(session, stored)
    this.events.emit('updated', {
      activeSessionId: this.getActiveSessionId(),
      session: cloneSession(session)
    })
  }

  public maybeSetFallbackTitle(sessionId: string, message: string): void {
    const session = this.requireSession(sessionId)

    if (session.isTitleGenerated || session.messageCount > 1) {
      return
    }

    session.title = createFallbackTitle(message)
    session.updatedAt = now()
    this.persistIndex(session)
    this.emitUpdated()
  }

  public async generateTitleFromFirstMessage(
    sessionId: string,
    message: string
  ): Promise<void> {
    try {
      await this.generateTitle(sessionId, message)
    } catch (error: unknown) {
      LogHelper.title('Session Manager')
      LogHelper.warning(`Failed to generate session title: ${error}`)
    }
  }

  public async runWithSession<T>(
    sessionId: string,
    callback: () => T | Promise<T>
  ): Promise<T> {
    const session = this.requireSession(sessionId)

    // Nested operations already belong to the same ordered turn.
    if (getActiveConversationSessionId() === session.id) {
      return callback()
    }

    // Capture before queueing: later UI/profile edits affect the next turn only.
    const modelTarget = session.modelTarget || CONFIG_STATE.getModelState().getAgentTargetValue()
    const context = { sessionId: session.id, modelTarget }
    const modelSettings = runWithConversationSession(context, () => {
      const target = CONFIG_STATE.getModelState().getAgentTarget()
      const defaults = CONFIG_STATE.getModelSettingsState().getSettings(target)

      return {
        target: target.label,
        settings: { ...defaults, ...session.modelSettings?.[target.label] }
      }
    })

    const previousOperation = this.sessionQueues.get(session.id) ||
      Promise.resolve()
    const operation = previousOperation.then(() => {
      // A queued background duty must not start after its owner deletes the session.
      this.requireSession(session.id)

      return runWithConversationSession(
        {
          ...context,
          modelSettings
        },
        callback
      )
    })
    const queueTail = operation.then(
      () => undefined,
      () => undefined
    )

    this.sessionQueues.set(session.id, queueTail)

    try {
      return await operation
    } finally {
      if (this.sessionQueues.get(session.id) === queueTail) {
        this.sessionQueues.delete(session.id)
      }
    }
  }

  private async generateTitle(
    sessionId: string,
    message: string
  ): Promise<void> {
    const session = this.requireSession(sessionId)

    if (session.isTitleGenerated || session.messageCount > 2) {
      return
    }

    const { LLM_PROVIDER } = await import('@/core')
    const { CONFIG_STATE } = await import('@/core/config-states/config-state')
    const workflowProvider = CONFIG_STATE.getModelState().getWorkflowTarget().provider

    if (!workflowProvider) {
      return
    }

    LogHelper.title('Session Manager')
    LogHelper.debug(`Generating title for session ${sessionId}`)

    const titleResult = await this.runWithSession(sessionId, () =>
      LLM_PROVIDER.prompt(message, {
        dutyType: LLMDuties.Inference,
        usagePurpose: InferencePurpose.SessionTitle,
        systemPrompt: SESSION_TITLE_SYSTEM_PROMPT,
        maxTokens: SESSION_TITLE_MAX_TOKENS,
        timeout: SESSION_TITLE_TIMEOUT_MS,
        maxRetries: SESSION_TITLE_MAX_RETRIES,
        temperature: 0.2,
        shouldStream: false,
        trackProviderErrors: false,
        ...getTitleReasoningParams(workflowProvider)
      })
    )
    const title = normalizeTitle(
      stripLeadingTitleTemplateTags(String(titleResult?.output || ''))
    )

    if (!this.findSession(sessionId)) {
      return
    }

    if (!title) {
      session.title = createFallbackTitle(message)
      session.isTitleGenerated = true
      session.updatedAt = now()
      this.persistIndex(session)
      this.emitUpdated()

      LogHelper.title('Session Manager')
      LogHelper.warning(
        `Session title generation returned no usable title for ${sessionId}; using fallback title`
      )
      return
    }

    session.title = title
    session.isTitleGenerated = true
    session.updatedAt = now()
    this.persistIndex(session)
    this.emitUpdated()

    LogHelper.title('Session Manager')
    LogHelper.success(`Generated session title: ${title}`)
  }

  private loadOrCreateIndex(): ConversationSessionIndex {
    const index = CONVERSATION_REPOSITORY.readIndex()
    if (index) {
      return this.normalizeIndex(index)
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

    CONVERSATION_REPOSITORY.saveSession({ ...session, messageCount: 0, lastMessageAt: null })
    for (const record of legacyLogs) {
      CONVERSATION_REPOSITORY.upsertMessage(session.id, record, { sentAt: record.sentAt })
    }
    Object.assign(session, CONVERSATION_REPOSITORY.readSession(session.id))

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
          : null,
      ...(session.modelSettings ? { modelSettings: session.modelSettings } : {})
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
    const conversationLogPath = path.join(
      getProfilePaths().root,
      'conversation_log.json'
    )

    if (!fs.existsSync(conversationLogPath)) {
      return []
    }

    try {
      const logs = JSON.parse(
        fs.readFileSync(conversationLogPath, 'utf-8')
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
    return path.join(getProfilePaths().sessions, sessionId)
  }

  private ensureSessionDirectory(sessionId: string): void {
    fs.mkdirSync(this.getSessionPath(sessionId), { recursive: true })
  }

  private persistIndex(changedSession?: ConversationSession): void {
    if (!this.index) {
      return
    }

    if (changedSession) {
      CONVERSATION_REPOSITORY.saveSession(changedSession)
    }
    CONVERSATION_REPOSITORY.saveActiveSession(this.index.activeSessionId)
  }

  private emitUpdated(): void {
    this.events.emit('updated', {
      activeSessionId: this.getActiveSessionId()
    })
  }
}

const sessionManagers = new Map<string, ConversationSessionManager>()

function getConversationSessionManager(): ConversationSessionManager {
  const profileName = getActiveProfileName()
  const existingManager = sessionManagers.get(profileName)

  if (existingManager) {
    return existingManager
  }

  const manager = new ConversationSessionManager()

  sessionManagers.set(profileName, manager)

  return manager
}

/**
 * Keep the existing API while routing state to the active profile runtime.
 */
export const CONVERSATION_SESSION_MANAGER = new Proxy(
  {} as ConversationSessionManager,
  {
    get: (_target, property): unknown => {
      const manager = getConversationSessionManager()
      const value = Reflect.get(manager, property)

      return typeof value === 'function' ? value.bind(manager) : value
    }
  }
)
