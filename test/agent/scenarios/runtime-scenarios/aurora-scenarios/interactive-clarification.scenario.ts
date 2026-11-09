import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { HTTPPluginAgentEvent } from '@/core/http-server/http-plugins/types'
import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { AURORA_QUERY_EXAMPLES } from '../../../../fixtures/aurora'

const scenario: RealAgentScenario = {
  async run() {
    const { runAgent } = await import('@/core/http-server/http-plugins/leon-services/agent-service')
    const { subscribeAgentEvents } = await import('@/core/http-server/http-plugins/leon-services/agent-event-channel')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
    const { WEB_SESSION_RUNTIME } = await import('@/core/session-manager/web-session-runtime')
    const { POST_TURN_MAINTENANCE_QUEUE } = await import('@/core')
    const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
    const requestId = randomUUID()
    const submissionId = randomUUID()
    const cursor = CONVERSATION_REPOSITORY.getReplayBounds().latest
    const events: HTTPPluginAgentEvent[] = []
    const completion = Promise.withResolvers<void>()
    const stop = await subscribeAgentEvents({ session_id: sessionId, after_sequence: cursor }, (event) => {
      events.push(event)
      if (event.turn_id === submissionId && event.type === 'turn_status' && event.data['status'] !== 'accepted') {
        completion.resolve()
      }
    })

    try {
      const first = await runAgent({ session_id: sessionId, request_id: requestId,
        query: AURORA_QUERY_EXAMPLES['single-choice'] })
      assert.equal(first.final_intent, 'clarification', first.answer)
      const messageId = `${requestId}:leon`
      const record = CONVERSATION_REPOSITORY.readMessage(sessionId, messageId)
      const part = record?.answerParts?.find((item) => item.kind === 'ui')
      assert.ok(part?.kind === 'ui', 'The question must have persisted native UI.')
      assert.equal(part.surface.status, 'ready')
      const entry = Object.entries(part.surface.spec.elements).find(([, node]) => node.type === 'Choice')
      assert.ok(entry && entry[1].type === 'Choice', 'The choice must be interactive.')
      const quiet = entry[1].props.options.find((option) => option.label.toLowerCase().includes('quiet'))
      assert.ok(quiet, 'The offered choices must include the requested quiet morning.')
      const input = { id: submissionId, surfaceId: part.surface.id, nodeId: entry[0], revision: part.surface.revision, values: [quiet.value] }
      WEB_SESSION_RUNTIME.submitUI(sessionId, messageId, input)
      await completion.promise
      await WEB_SESSION_RUNTIME.stop(sessionId)
      const answer = CONVERSATION_REPOSITORY.readMessage(sessionId, `${submissionId}:leon`)
      assert.ok(answer?.isAddedToHistory && answer.message.toLowerCase().includes('quiet'), answer?.message)
      const repeated = WEB_SESSION_RUNTIME.submitUI(sessionId, messageId, input)
      assert.equal(repeated.command.id, submissionId)
      assert.equal(repeated.command.status, 'completed')
      assert.equal(events.filter((event) => event.type === 'owner_message' && event.turn_id === submissionId).length, 1)
      await POST_TURN_MAINTENANCE_QUEUE.whenIdle()
      const replay: HTTPPluginAgentEvent[] = []
      const disconnect = await subscribeAgentEvents({ session_id: sessionId, after_sequence: cursor }, (event) => replay.push(event))
      disconnect()
      assert.deepEqual(replay, JSON.parse(JSON.stringify(events)))

      return { sessionId, first: first.answer, continued: answer.message, receipt: repeated.answerParts,
        events: events.map((event) => ({ type: event.type, sequence: event.sequence })) }
    } finally {
      stop()
      await WEB_SESSION_RUNTIME.stop(sessionId)
    }
  }
}

export default scenario
