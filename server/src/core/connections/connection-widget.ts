import { CONNECTION_SETUP_MESSAGES } from './connection-setup'

import { SOCKET_SERVER, TOOLKIT_REGISTRY } from '@/core'
import { getActiveConversationSessionId, getActiveConversationResponseId } from '@/core/session-manager/session-context'

/**
 * Displays setup only for a tool requested in this profile's current conversation.
 */
export function emitConnectionWidget(provider: string, presentation?: { name: string, description?: string, iconName: string, logoUrl?: string }): void {
  const [toolkitId, toolId] = provider.split('.')
  const remote = !presentation && toolkitId && toolId && TOOLKIT_REGISTRY.getToolSource(toolkitId, toolId)?.type === 'mcp'
    ? TOOLKIT_REGISTRY.resolveToolById(toolId, toolkitId) : undefined
  const tool = presentation ? { name: presentation.name, description: presentation.description, icon_name: presentation.iconName }
    : remote ? { name: remote.toolName, description: remote.toolDescription, icon_name: remote.toolIconName }
    : TOOLKIT_REGISTRY.getConnectionTool(provider)
  const sessionId = getActiveConversationSessionId()
  const logoUrl = presentation?.logoUrl ?? (toolkitId && toolId ? TOOLKIT_REGISTRY.getToolLogoUrl(toolkitId, toolId) : undefined)
  const responseId = getActiveConversationResponseId()
  const id = `connection-${responseId || sessionId || 'current'}-${provider}`

  SOCKET_SERVER.emitAnswerToChatClients({
    id,
    replaceMessageId: id,
    widget: 'ConnectionWidget',
    ...(responseId ? { responseId } : {}),
    connection: {
      provider,
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      ...(logoUrl ? { logoUrl } : {}),
      ...(tool.icon_name ? { iconName: tool.icon_name } : {})
    },
    historyMode: 'system_widget',
    fallbackText: `Set up ${tool.name} to continue.`,
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
