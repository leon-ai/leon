import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import type {
  SessionSearchResult,
  SessionSearchRole
} from '@@/server/src/core/session-manager/session-search'
import type {
  ArchiveMessagePage,
  ArchiveMessageReadOptions
} from '@@/bridges/runtime/contracts/conversation-archive'

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
}
