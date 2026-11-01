import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run() {
    const { NLU, POST_TURN_MAINTENANCE_QUEUE } = await import('@/core')
    const { RoutingMode } = await import('@/types')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
    await CONVERSATION_SESSION_MANAGER.runWithSession(sessionId, async () => {
      await NLU.process('Reply with the word cobalt only; no tool is needed.', {
        forcedRoutingMode: RoutingMode.Agent
      })
      assert.equal(NLU.currentResponseRoute, 'react')
    })
    await POST_TURN_MAINTENANCE_QUEUE.whenIdle()
    const { CONVERSATION_LOGGER } = await import('@/core')
    const history = await CONVERSATION_LOGGER.loadAll({ sessionId })
    assert.equal(history.filter((entry) => entry.who === 'owner').length, 1)
    assert.ok(history.some((entry) => entry.who === 'leon' && entry.message.toLowerCase().includes('cobalt')))

    return { sessionId, route: 'react' }
  }
}

export default scenario
