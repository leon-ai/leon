import assert from 'node:assert/strict'

import type { HTTPPluginAgentEvent } from '@/core/http-server/http-plugins/types'
import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run() {
    const { runAgent } = await import('@/core/http-server/http-plugins/leon-services/agent-service')
    const { subscribeAgentEvents } = await import('@/core/http-server/http-plugins/leon-services/agent-event-channel')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
    const { POST_TURN_MAINTENANCE_QUEUE } = await import('@/core')
    const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
    const cursor = CONVERSATION_REPOSITORY.getReplayBounds().latest
    const live: HTTPPluginAgentEvent[] = []
    const stop = await subscribeAgentEvents({ session_id: sessionId, after_sequence: cursor }, (event) => live.push(event))
    try {
      const result = await runAgent({ session_id: sessionId, query: 'Reply with the word spruce only. No tools are needed.' })
      assert.equal(result.final_intent, 'answer')
      assert.ok(result.answer.toLowerCase().includes('spruce'))
      await POST_TURN_MAINTENANCE_QUEUE.whenIdle()
    } finally {
      stop()
    }
    const replay: HTTPPluginAgentEvent[] = []
    const disconnect = await subscribeAgentEvents({ session_id: sessionId, after_sequence: cursor }, (event) => replay.push(event))
    disconnect()
    // Compare the JSON wire contract; persistence omits undefined object fields.
    assert.deepEqual(replay, JSON.parse(JSON.stringify(live)))
    assert.equal(replay.filter((event) => event.type === 'final_answer').length, 1)
    assert.equal(new Set(replay.map((event) => event.sequence)).size, replay.length)
    const afterFinal: HTTPPluginAgentEvent[] = []
    const stopFinal = await subscribeAgentEvents({ session_id: sessionId, after_sequence: replay.at(-1)!.sequence }, (event) => afterFinal.push(event))
    stopFinal()
    assert.deepEqual(afterFinal, [])

    return { sessionId, events: replay.map((event) => ({ type: event.type, sequence: event.sequence })) }
  }
}

export default scenario
