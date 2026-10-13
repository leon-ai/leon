import { recordArtifacts } from './artifact-context'

import { CONVERSATION_LOGGER, SOCKET_SERVER } from '@/core'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { publishAgentEvent } from '@/core/http-server/http-plugins/leon-services/agent-event-channel'
import { readArtifact } from './artifact-store'
import type { Artifact } from './artifact-types'

/**
 * Publishes a durable attachment message through both client interfaces.
 */
export async function attachArtifacts(
  sessionId: string,
  ids: string[]
): Promise<Artifact[]> {
  if (!CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
    throw new Error('Conversation session does not exist.')
  }

  const artifacts = await Promise.all(
    [...new Set(ids)].map(
      async (id) => (await readArtifact(sessionId, id)).artifact
    )
  )

  if (!artifacts.length) {
    return []
  }

  recordArtifacts(artifacts)
  const messageId = `artifacts:${artifacts.map((artifact) => artifact.id).join(':')}`
  const message = artifacts.map((artifact) => artifact.filename).join(', ')

  await CONVERSATION_LOGGER.upsert(
    {
      who: 'leon',
      message,
      messageId,
      isAddedToHistory: true,
      artifacts
    },
    { sessionId }
  )
  publishAgentEvent(getActiveProfileName(), {
    session_id: sessionId,
    turn_id: null,
    response_id: messageId,
    type: 'artifacts',
    data: { message_id: messageId, artifacts, content: message }
  })
  SOCKET_SERVER.emitAnswerToChatClients(
    { answer: message, messageId, artifacts },
    { sessionId }
  )

  return artifacts
}
