import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import { isValidProfileName } from '@/core/profile-runtime/profile-paths'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'

import type {
  HTTPPluginAgentEvent,
  HTTPPluginConversationSessionMutationResult,
  HTTPPluginCreateConversationSessionInput,
  HTTPPluginListConversationSessionsInput,
  HTTPPluginListConversationSessionsResult,
  HTTPPluginPublishConversationEventInput,
  HTTPPluginSelectConversationSessionInput
} from '../types'
import { publishAgentEvent } from './agent-event-channel'
import { normalizeConversationSession } from './normalizers'

function resolveProfileName(profileId?: string): string {
  const profileName = profileId?.trim() || getActiveProfileName()
  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  return profileName
}

/** Lists conversation sessions inside one trusted profile runtime. */
export async function listConversationSessions(
  input: HTTPPluginListConversationSessionsInput
): Promise<HTTPPluginListConversationSessionsResult> {
  const profileName = resolveProfileName(input.profile_id)

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()

    return {
      profile_id: getActiveProfileName(),
      active_session_id: CONVERSATION_SESSION_MANAGER.getActiveSessionId(),
      sessions: CONVERSATION_SESSION_MANAGER.listSessions().map(
        normalizeConversationSession
      )
    }
  })
}

/** Creates and activates an owner-scoped conversation session. */
export async function createConversationSession(
  input: HTTPPluginCreateConversationSessionInput
): Promise<HTTPPluginConversationSessionMutationResult> {
  const profileName = resolveProfileName(input.profile_id)

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    const session = CONVERSATION_SESSION_MANAGER.createSession()
    const normalizedSession = normalizeConversationSession(session)
    publishAgentEvent(getActiveProfileName(), {
      session_id: session.id,
      turn_id: null,
      response_id: null,
      type: 'session_changed',
      data: { session: normalizedSession, is_active: true }
    })

    return {
      profile_id: getActiveProfileName(),
      active_session_id: session.id,
      session: normalizedSession
    }
  })
}

/** Selects an existing owner-scoped conversation session. */
export async function selectConversationSession(
  input: HTTPPluginSelectConversationSessionInput
): Promise<HTTPPluginConversationSessionMutationResult> {
  const profileName = resolveProfileName(input.profile_id)

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    const session = CONVERSATION_SESSION_MANAGER.setActiveSession(
      input.session_id.trim()
    )
    const normalizedSession = normalizeConversationSession(session)
    publishAgentEvent(getActiveProfileName(), {
      session_id: session.id,
      turn_id: null,
      response_id: null,
      type: 'session_changed',
      data: { session: normalizedSession, is_active: true }
    })

    return {
      profile_id: getActiveProfileName(),
      active_session_id: session.id,
      session: normalizedSession
    }
  })
}

/** Publishes a trusted integration event into an existing session stream. */
export async function publishConversationEvent(
  input: HTTPPluginPublishConversationEventInput
): Promise<HTTPPluginAgentEvent> {
  const profileName = resolveProfileName(input.profile_id)

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    const sessionId = input.session_id.trim()
    if (!sessionId || !CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
      throw new Error(
        `Conversation session "${sessionId}" does not exist in profile "${profileName}".`
      )
    }

    return publishAgentEvent(getActiveProfileName(), {
      session_id: sessionId,
      turn_id: input.turn_id?.trim() || null,
      response_id: input.response_id?.trim() || null,
      type: input.type,
      data: input.data
    })
  })
}
