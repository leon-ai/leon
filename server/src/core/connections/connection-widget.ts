import { CONNECTION_SETUP_MESSAGES } from './connection-setup'

import { SOCKET_SERVER, TOOLKIT_REGISTRY } from '@/core'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'

/**
 * Displays setup only for a tool requested in this profile's current conversation.
 */
export function emitConnectionWidget(provider: string): void {
  const tool = TOOLKIT_REGISTRY.getConnectionTool(provider)
  const sessionId = getActiveConversationSessionId()
  const id = `connection-${sessionId || 'current'}-${provider}`

  SOCKET_SERVER.emitAnswerToChatClients({
    id,
    replaceMessageId: id,
    widget: 'ConnectionWidget',
    historyMode: 'system_widget',
    fallbackText: `Connect ${tool.name} to continue. You can use guided setup in your browser or connect manually below.`,
    supportedEvents: [],
    componentTree: {
      component: 'WidgetWrapper',
      id: `${id}-wrapper`,
      events: [],
      props: {
        children: [
          {
            component: 'ConnectionSetup',
            id,
            props: { provider, sessionId, messages: CONNECTION_SETUP_MESSAGES },
            events: []
          }
        ]
      }
    }
  })
}
