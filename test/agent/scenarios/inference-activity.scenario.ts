import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { RealAgentScenario } from '../e2e/run-agent-provider-scenario'
import type { HTTPPluginAgentEvent } from '@/core/http-server/http-plugins/types'
import type { InferenceActivity } from '@/core/llm-manager/turn-timing-contract'

const scenario: RealAgentScenario = {
  toolResult(input) {
    // Real model decisions exercise the lifecycle without external-service side effects.
    return {
      status: 'success',
      message: 'Weather observation retrieved.',
      data: {
        tool_id: input.toolId,
        toolkit_id: input.toolkitId,
        function_name: input.functionName,
        input: input.toolInput || null,
        parsed_input: input.parsedInput || null,
        output: {
          result: {
            success: true,
            data: { temperature: 18, unit: 'C', conditions: 'clear sky' }
          }
        }
      }
    }
  },
  async run() {
    // Runtime imports follow the runner's isolated profile initialization.
    const { runAgent } = await import('@/core/http-server/http-plugins/leon-services/agent-service')
    const { subscribeAgentEvents } = await import('@/core/http-server/http-plugins/leon-services/agent-event-channel')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
    const { POST_TURN_MAINTENANCE_QUEUE } = await import('@/core')
    const { TurnPhase } = await import('@/core/llm-manager/turn-timing-contract')
    const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
    const requestId = randomUUID()
    const cursor = CONVERSATION_REPOSITORY.getReplayBounds().latest
    const events: HTTPPluginAgentEvent[] = []
    const unsubscribe = await subscribeAgentEvents(
      { session_id: sessionId, after_sequence: cursor },
      (event) => events.push(event)
    )

    try {
      const result = await runAgent({
        session_id: sessionId,
        request_id: requestId,
        query: 'Check the current weather in both Haarlem and Amsterdam, Netherlands using the weather tool for each city. Compare the observations in one short sentence.'
      })
      await POST_TURN_MAINTENANCE_QUEUE.whenIdle()
      assert.equal(result.final_intent, 'answer')
      assert.ok(result.answer.trim())

      const activities = events
        .filter((event) => event.type === 'inference_activity')
        .map((event) => ({ event, activity: event.data['activity'] as InferenceActivity }))
      assert.ok(activities.length > 0)

      for (const { event, activity } of activities) {
        assert.equal(event.turn_id, requestId)
        assert.deepEqual(Object.keys(activity).sort(), ['durationMs', 'goal', 'id', 'outcome', 'startedAt'])
        assert.ok(result.response_trace.timings?.some(
          (timing) => timing.kind === 'inference' && timing.id === activity.id
        ))
      }

      const reviewStart = activities.find(
        ({ activity }) => activity.goal === TurnPhase.Review && activity.outcome === 'started'
      )
      assert.ok(reviewStart, 'Review must become visible before it finishes.')
      const reviewEnd = activities.find(
        ({ activity }) => activity.id === reviewStart.activity.id && activity.outcome === 'completed'
      )
      assert.ok(reviewEnd)
      assert.ok(reviewEnd.activity.durationMs > 0)
      assert.ok(reviewStart.event.sequence < reviewEnd.event.sequence)
      assert.ok(reviewEnd.event.sequence < events.find((event) => event.type === 'final_answer')!.sequence)

      const replay: HTTPPluginAgentEvent[] = []
      const stopReplay = await subscribeAgentEvents(
        { session_id: sessionId, after_sequence: cursor },
        (event) => replay.push(event)
      )
      stopReplay()
      assert.deepEqual(
        replay.filter((event) => event.type === 'inference_activity'),
        activities.map(({ event }) => event)
      )

      return { sessionId, requestId, activities: activities.map(({ activity }) => activity) }
    } finally {
      unsubscribe()
    }
  }
}

export default scenario
