import assert from 'node:assert/strict'
import { COMPUTER_USE_PERMISSION_WIDGET } from '@@/bridges/runtime/contracts/desktop-client'
import { TurnClientOS, TurnClientType } from '@@/bridges/runtime/contracts/turn-client'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run(context) {
    const { SOCKET_SERVER } = await import('@/core')
    const { runWithTurnClient } = await import('@/core/leon-interface/turn-client')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const original = SOCKET_SERVER.emitAnswerToChatClients
    const offered = new Set<string>()

    SOCKET_SERVER.emitAnswerToChatClients = (payload, options): void => {
      if (payload && typeof payload === 'object' && 'widget' in payload &&
        payload.widget === COMPUTER_USE_PERMISSION_WIDGET && 'id' in payload && typeof payload.id === 'string') {
        offered.add(payload.id)
      }
      original.call(SOCKET_SERVER, payload, options)
    }

    const request = 'I need to see my local desktop. Check the catalog for computer_use.cua and tell me how to enable it if this client still needs permission.'
    try {
      const desktop = await runWithTurnClient(TurnClientType.Desktop, TurnClientOS.Linux, () =>
        context.runTurn(request, CONVERSATION_SESSION_MANAGER.createSession().id))
      assert.equal(offered.size, 1)
      assert.ok(desktop.executionHistory.every(({ function: name }) => !name.startsWith('computer_use.cua.')))

      await runWithTurnClient(TurnClientType.Web, TurnClientOS.Linux, () =>
        context.runTurn(request, CONVERSATION_SESSION_MANAGER.createSession().id))
      assert.equal(offered.size, 1)

      return { offers: [...offered] }
    } finally {
      SOCKET_SERVER.emitAnswerToChatClients = original
    }
  }
}

export default scenario
