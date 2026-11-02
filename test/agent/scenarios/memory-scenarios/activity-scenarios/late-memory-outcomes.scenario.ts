import assert from 'node:assert/strict'

import type { RealAgentScenario, RealScenarioTurn } from '../../../e2e/run-agent-provider-scenario'
import type { AgentProgressMessage } from '@/core/llm-manager/agent-progress-contract'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { POST_TURN_MAINTENANCE_QUEUE } = await import('@/core')
      const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
      const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
      const { runTurnLifecycle } = await import('@/core/turn-lifecycle')
      const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
      const gate = Promise.withResolvers<void>()
      const outcomes: AgentProgressMessage[] = []
      POST_TURN_MAINTENANCE_QUEUE.enqueue('scenario occupied maintenance', () => gate.promise)
      let first!: RealScenarioTurn
      let responseId = ''
      let before
      try {
        const query = 'My permanent office is in Utrecht, and I work there every Monday. This is my ongoing arrangement. Reply briefly without tools.'
        await runTurnLifecycle({ sessionId, query, onActivity: (message) => outcomes.push(message) }, async () => {
          first = await context.runTurn(query, sessionId)
          assert.equal(first.hasExplicitMemoryWrite, false)
          return { output: first.output, data: {
            finalIntent: first.finalIntent, executionHistory: first.executionHistory,
            agentResponseTrace: first.responseTrace, workspace
          } } as unknown as LLMDutyResult
        })
        assert.ok(first.responseTrace.id)
        responseId = first.responseTrace.id
        before = CONVERSATION_REPOSITORY.readMessage(sessionId, responseId)!
        assert.equal(before.message, first.output)
        assert.equal(outcomes.length, 0)
        await context.runTurn('Thanks. Reply briefly without tools.', sessionId)
      } finally {
        gate.resolve()
        await POST_TURN_MAINTENANCE_QUEUE.whenIdle()
      }
      const after = CONVERSATION_REPOSITORY.readMessage(sessionId, responseId)!
      assert.ok(outcomes.length > 0)
      assert.equal(after.message, before!.message)
      assert.equal(after.sentAt, before!.sentAt)
      assert.equal(after.isAddedToHistory, true)
      assert.ok(outcomes.some((message) => message.memory?.entries.some((entry) => entry.content.includes('Utrecht'))))
      assert.ok(outcomes.every((message) => message.iconName === 'brain-2-line'))
      assert.ok(after.agentResponseTrace?.progressMessages?.some((message) => message.id === outcomes[0]!.id))
      return { first, outcomes }
    })
  }
}

export default scenario
