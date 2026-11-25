import { SOCKET_SERVER, TOOLKIT_REGISTRY } from '@/core'
import { getTurnClient } from '@/core/leon-interface/turn-client'
import { getActiveConversationResponseId } from '@/core/session-manager/session-context'
import { ProfileHelper } from '@/helpers/profile-helper'
import { COMPUTER_USE_PERMISSION_WIDGET } from '@@/bridges/runtime/contracts/desktop-client'
import { COMPUTER_USE_TOOL_ID, COMPUTER_USE_TOOLKIT_ID, ToolExecutionTarget } from '@@/bridges/runtime/contracts/device-execution'
import { TurnClientType } from '@@/bridges/runtime/contracts/turn-client'

export const COMPUTER_USE_PERMISSION_REQUIRED = 'The owner can click Enable computer use in Leon Desktop and confirm the native dialog. Desktop will use this computer automatically on the next request.'

/**
 * Offers the local permission action when the Desktop turn has no device.
 * Displaying the action grants no access or control to the server.
 */
export function showComputerUsePermission(): boolean {
  const responseId = getActiveConversationResponseId()
  if (!responseId || getTurnClient().type !== TurnClientType.Desktop ||
    ProfileHelper.isToolDisabled(COMPUTER_USE_TOOL_ID, COMPUTER_USE_TOOLKIT_ID) ||
    TOOLKIT_REGISTRY.getToolExecutionTarget(COMPUTER_USE_TOOLKIT_ID, COMPUTER_USE_TOOL_ID) !== ToolExecutionTarget.Device ||
    TOOLKIT_REGISTRY.getToolDeviceSelection(COMPUTER_USE_TOOLKIT_ID, COMPUTER_USE_TOOL_ID)) {
    return false
  }

  const id = `computer-use-permission-${responseId}`
  SOCKET_SERVER.emitAnswerToChatClients({
    id, replaceMessageId: id, responseId, widget: COMPUTER_USE_PERMISSION_WIDGET,
    historyMode: 'system_widget', supportedEvents: [],
    fallbackText: 'I need permission to use this computer.',
    componentTree: { component: 'WidgetWrapper', id, props: { children: [] }, events: [] }
  })

  return true
}
