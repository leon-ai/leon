import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import type {
  SessionSearchResult,
  SessionSearchRole
} from '@@/server/src/core/session-manager/session-search'
import type {
  ArchiveMessagePage,
  ArchiveMessageReadOptions,
  ArchiveSessionListPage,
  ArchiveSessionPage,
  ArchiveSessionReadOptions
} from '@@/bridges/runtime/contracts/conversation-archive'

const DEFAULT_DISCOVERY_LIMIT = 5

interface ListSessionsOptions {
  query?: string
  limit?: number
  cursor?: string
  includeCurrentSession?: boolean
}

interface SearchSessionsOptions {
  role?: SessionSearchRole
  topK?: number
  contextWindow?: number
  includeCurrentSession?: boolean
}

export default class SessionsTool extends Tool {
  private static readonly TOOLKIT = 'structured_knowledge'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    this.config = ToolkitConfig.load(SessionsTool.TOOLKIT, this.toolName)
    this.settings = ToolkitConfig.loadToolSettings(
      SessionsTool.TOOLKIT,
      this.toolName,
      {}
    )
    this.requiredSettings = []
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    return 'sessions'
  }

  get toolkit(): string {
    return SessionsTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Discover archived sources when their title or identifying terms are unknown.
   */
  public async listSessions(
    options: ListSessionsOptions = {}
  ): Promise<{ success: boolean, data: ArchiveSessionListPage }> {
    const query = new URLSearchParams({
      limit: String(options.limit ?? DEFAULT_DISCOVERY_LIMIT)
    })
    if (options.query !== undefined) {
      query.set('query', options.query)
    }
    if (options.cursor !== undefined) {
      query.set('cursor', options.cursor)
    }

    const result = await this.requestLeon<{
      success: boolean
      sessions: Array<{
        id: string
        title: string
        createdAt: number
        updatedAt: number
        messageCount: number
      }>
      next_cursor: string | null
    }>(`/sessions/page?${query}`)
    const current = options.includeCurrentSession
      ? undefined : this.executionContext?.conversationSessionId

    return {
      success: result.success,
      data: {
        sessions: result.sessions
          .filter((session) => session.id !== current)
          .map((session) => ({
            sessionId: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.messageCount
          })),
        nextCursor: result.next_cursor
      }
    }
  }

  public async searchSessions(
    query: string,
    options: SearchSessionsOptions = {}
  ): Promise<{ success: boolean, data: SessionSearchResult }> {
    const currentSessionId = this.executionContext?.conversationSessionId

    return this.requestLeon('/sessions/search', {
      query,
      ...options,
      ...(currentSessionId ? { currentSessionId } : {})
    })
  }

  /**
   * Recover a bounded page of the selected archived message without repeating search.
   */
  public async readMessage(
    sessionId: string,
    messageId: string,
    options: ArchiveMessageReadOptions = {}
  ): Promise<{ success: boolean, data: ArchiveMessagePage }> {
    const query = new URLSearchParams()
    if (options.offset !== undefined) {
      query.set('offset', String(options.offset))
    }
    if (options.limit !== undefined) {
      query.set('limit', String(options.limit))
    }
    const suffix = query.size > 0 ? `?${query}` : ''

    return this.requestLeon(
      `/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/text${suffix}`
    )
  }

  /**
   * Recover ordered source text across messages with a bounded continuation.
   */
  public async readSession(
    sessionId: string,
    options: ArchiveSessionReadOptions = {}
  ): Promise<{ success: boolean, data: ArchiveSessionPage }> {
    const query = new URLSearchParams()
    if (options.cursor !== undefined) {
      query.set('cursor', options.cursor)
    }
    if (options.limit !== undefined) {
      query.set('limit', String(options.limit))
    }
    if (options.role !== undefined) {
      query.set('role', options.role)
    }

    const suffix = query.size > 0 ? `?${query}` : ''

    return this.requestLeon(`/sessions/${encodeURIComponent(sessionId)}/text${suffix}`)
  }
}
