import {
  generateMedia,
  listMediaCapabilities,
  listMediaDefaults,
  readGenerationSettings,
  saveGenerationSettings
} from '@/core/llm-manager/media-generation/media-generation-service'
import { registerArtifact, readArtifact } from '@/core/artifacts/artifact-store'
import { attachArtifacts } from '@/core/artifacts/artifact-service'
import {
  CONVERSATION_LOGGER,
  LLM_MANAGER
} from '@/core'
import {
  getActiveProfileName,
  runWithProfileContext
} from '@/core/profile-runtime/profile-context'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import { isValidProfileName } from '@/core/profile-runtime/profile-paths'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { ConversationHistoryHelper } from '@/helpers/conversation-history-helper'
import { handleConnectionSetup } from '@/core/connections/connection-setup'
import {
  saveConnection,
  startConnectionOAuth
} from '@/core/connections/connection-service'
import { getConnectionCatalog } from '@/core/connections/connection-catalog'
import {
  CONNECTION_STORE,
  type ConnectionSummary
} from '@/core/connections/connection-store'

import type {
  HTTPPluginAppendConversationMessageInput,
  HTTPPluginAppendConversationMessageResult,
  HTTPPluginConversationMessage,
  HTTPPluginGetConversationHistoryInput,
  HTTPPluginGetConversationHistoryResult,
  HTTPPluginLeonServices,
  HTTPPluginSaveConnectionInput
} from './types'
import {
  publishAgentEvent,
  subscribeAgentEvents
} from './leon-services/agent-event-channel'
export { subscribeAgentEvents } from './leon-services/agent-event-channel'
import {
  normalizeHistoryLimit
} from './leon-services/normalizers'
import {
  deserializeAgentTrace,
  serializeAgentTrace
} from './leon-services/agent-trace-serializer'
import { runAgent } from './leon-services/agent-service'
export { runAgent } from './leon-services/agent-service'
import { runControlledSkill } from './leon-services/controlled-skill-service'
export { runControlledSkill } from './leon-services/controlled-skill-service'
import {
  createConversationSession,
  listConversationSessions,
  publishConversationEvent,
  selectConversationSession
} from './leon-services/conversation-session-service'
export {
  createConversationSession,
  listConversationSessions,
  publishConversationEvent,
  selectConversationSession
} from './leon-services/conversation-session-service'

/**
 * Reads persisted, user-visible conversation messages for one profile session.
 */
export async function getConversationHistory(
  input: HTTPPluginGetConversationHistoryInput
): Promise<HTTPPluginGetConversationHistoryResult> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()

  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    const sessionId = input.session_id.trim()

    if (!sessionId) {
      throw new Error('A conversation session ID is required.')
    }
    if (!CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
      throw new Error(
        `Conversation session "${sessionId}" does not exist in profile "${profileName}".`
      )
    }

    const logs = await CONVERSATION_LOGGER.load({
      sessionId,
      nbOfLogsToLoad: normalizeHistoryLimit(input.limit)
    })
    const messages: HTTPPluginConversationMessage[] =
      ConversationHistoryHelper.toHistoryItems(
        logs.filter((log) => ConversationHistoryHelper.isVisibleInHistory(log)),
        { supportsWidgets: false, source: 'conversation_history' }
      ).map((item) => ({
        ...('inference' in item ? { inference: item.inference } : {}),
        ...(item.widget ? { widget: item.widget } : {}),
        ...(item.artifacts?.length ? { artifacts: item.artifacts } : {}),
        role: item.who === 'leon' ? 'assistant' : 'owner',
        content: item.string,
        created_at: item.sentAt,
        message_id: item.messageId || null,
        metrics: item.llmMetrics || null,
        response_trace: item.agentResponseTrace
          ? serializeAgentTrace(
              item.agentResponseTrace,
              input.include_developer_provenance === true
            )
          : null
      }))

    return {
      profile_id: getActiveProfileName(),
      session_id: sessionId,
      messages
    }
  })
}

/**
 * Adds externally produced conversation content to an existing profile session.
 * This lets integrations preserve continuity without running another inference.
 */
export async function appendConversationMessage(
  input: HTTPPluginAppendConversationMessageInput
): Promise<HTTPPluginAppendConversationMessageResult> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()

  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    const sessionId = input.session_id.trim()
    const message = input.message.trim()

    if (!sessionId) {
      throw new Error('A conversation session ID is required.')
    }
    if (!CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
      throw new Error(
        `Conversation session "${sessionId}" does not exist in profile "${profileName}".`
      )
    }
    if (!message) {
      throw new Error('A conversation message is required.')
    }

    const widget = input.role === 'assistant' ? input.widget : undefined

    if (widget && !ConversationHistoryHelper.isRenderableWidget(widget)) {
      throw new Error('A renderable conversation widget is required.')
    }

    const messageId = widget?.id || input.message_id
    const artifacts = input.artifacts?.length ? input.artifacts : undefined

    await CONVERSATION_LOGGER.upsert(
      {
        who: input.role === 'assistant' ? 'leon' : 'owner',
        message,
        // UI-only cards stay visible in history without entering the model transcript.
        isAddedToHistory: !widget,
        ...(messageId ? { messageId } : {}),
        ...(widget ? { widget } : {}),
        ...(artifacts ? { artifacts } : {}),
        ...(input.role === 'assistant' && input.response_trace
          ? {
              agentResponseTrace: deserializeAgentTrace(input.response_trace)
            }
          : {})
      },
      { sessionId }
    )

    if (input.role === 'assistant') {
      publishAgentEvent(getActiveProfileName(), {
        session_id: sessionId,
        turn_id: messageId || null,
        response_id: messageId || null,
        type: widget ? 'widget' : artifacts ? 'artifacts' : 'final_answer',
        data: widget ? { widget } : {
          ...(artifacts ? { artifacts } : {}),
          message_id: messageId || '',
          content: message,
          response_trace: input.response_trace || {
            plan_steps: [],
            tool_calls: []
          }
        }
      })
    }

    return {
      profile_id: getActiveProfileName(),
      session_id: sessionId,
      role: input.role,
      message_id: messageId || null
    }
  })
}

export function createHTTPPluginLeonServices(): HTTPPluginLeonServices {
  return {
    get profileId(): string {
      return getActiveProfileName()
    },
    isLLMEnabled: () => LLM_MANAGER.isLLMEnabled,
    runAgent,
    runControlledSkill,
    appendConversationMessage,
    publishConversationEvent,
    listConversationSessions,
    getConversationHistory,
    createConversationSession,
    selectConversationSession,
    subscribeAgentEvents,
    handleConnectionSetup,
    generateMedia,
    listMediaCapabilities,
    listMediaDefaults,
    readGenerationSettings,
    saveGenerationSettings,
    registerArtifact,
    readArtifact: async (sessionId, id, profileId): ReturnType<typeof readArtifact> => {
      const profileName = profileId?.trim() || getActiveProfileName()

      if (!isValidProfileName(profileName)) {
        throw new Error('Invalid artifact profile.')
      }

      return runWithProfileContext({ profileName }, async () => {
        await ensureActiveProfileRuntime()
        if (!CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
          throw new Error('Artifact conversation not found.')
        }

        return readArtifact(sessionId, id)
      })
    },
    attachArtifacts,
    listConnections: async (
      profileId,
      callback
    ): Promise<{
      profile_id: string
      connections: ConnectionSummary[]
      tools: Awaited<ReturnType<typeof getConnectionCatalog>>
    }> => {
      const profileName = profileId?.trim() || getActiveProfileName()

      if (!isValidProfileName(profileName)) {
        throw new Error(`Invalid Leon profile name "${profileName}".`)
      }

      return runWithProfileContext({ profileName }, async () => {
        await ensureActiveProfileRuntime()

        return {
          profile_id: getActiveProfileName(),
          connections: await CONNECTION_STORE.list(),
          tools: await getConnectionCatalog(callback)
        }
      })
    },
    saveConnection: async (
      input: HTTPPluginSaveConnectionInput
    ): Promise<ConnectionSummary> => {
      const profileName = input.profile_id?.trim() || getActiveProfileName()

      if (!isValidProfileName(profileName)) {
        throw new Error(`Invalid Leon profile name "${profileName}".`)
      }

      return runWithProfileContext({ profileName }, () => saveConnection(input))
    },
    startConnectionOAuth: async (
      input
    ): ReturnType<typeof startConnectionOAuth> => {
      const profileName = input.profile_id?.trim() || getActiveProfileName()

      if (!isValidProfileName(profileName)) {
        throw new Error('Invalid Leon profile name.')
      }

      return startConnectionOAuth({
        provider: input.provider,
        profileName,
        callbackOrigin: input.callback_origin,
        returnURL: input.return_url,
        apiVersion: input.api_version,
        ...(input.client_id ? { clientId: input.client_id } : {}),
        ...(input.client_secret ? { clientSecret: input.client_secret } : {})
      })
    },
    removeConnection: async (provider, profileId): Promise<boolean> => {
      const profileName = profileId?.trim() || getActiveProfileName()

      if (!isValidProfileName(profileName)) {
        throw new Error(`Invalid Leon profile name "${profileName}".`)
      }

      return runWithProfileContext({ profileName }, () =>
        CONNECTION_STORE.remove(provider)
      )
    }
  }
}
