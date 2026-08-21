import { PROFILE_SESSIONS_PATH } from '@bridge/constants'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import {
  searchConversationSessions,
  type SessionSearchResult,
  type SessionSearchRole
} from '@@/server/src/core/session-manager/session-search'

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
    const currentSessionId = process.env['LEON_SESSION_ID'] || undefined

    return {
      success: true,
      data: await searchConversationSessions({
        sessionsPath: PROFILE_SESSIONS_PATH,
        query,
        ...options,
        ...(currentSessionId ? { currentSessionId } : {})
      })
    }
  }
}
