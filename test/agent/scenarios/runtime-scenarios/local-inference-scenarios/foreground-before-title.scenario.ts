import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'

const scenario: RealAgentScenario = {
  async run({ runTurn }) {
    const { LLM_PROVIDER, POST_TURN_MAINTENANCE_QUEUE } = await import('@/core')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const { runTurnLifecycle } = await import('@/core/turn-lifecycle')
    const { readTurnHistory } = await import('@/core/llm-manager/turn-timing')
    const { InferencePurpose } = await import('@/core/llm-manager/types')
    const nativeScheduling = Boolean(await LLM_PROVIDER.getAgentNativeContextWindowTokens())
    const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
    const turnId = randomUUID()
    const query = 'Reply with exactly READY. Do not use tools.'
    let deliveredAt = 0

    await runTurnLifecycle({ sessionId, turnId, query }, async () => {
      const turn = await runTurn(query, sessionId)
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.output.includes('READY'), turn.output)
      deliveredAt = Date.now()

      return { output: turn.output, data: {
        finalIntent: turn.finalIntent, executionHistory: turn.executionHistory
      } } as unknown as LLMDutyResult
    })
    await POST_TURN_MAINTENANCE_QUEUE.whenIdle()
    assert.equal(CONVERSATION_SESSION_MANAGER.getSession(sessionId)?.isTitleGenerated, true)
    const titleRequests = []
    for await (const record of readTurnHistory({ turnId })) {
      if (record['kind'] === 'inference' && record['purpose'] === InferencePurpose.SessionTitle) {
        titleRequests.push(record)
      }
    }
    assert.ok(titleRequests.length > 0)
    if (nativeScheduling) {
      assert.ok(titleRequests.every((request) => Number(request['startedAt']) >= deliveredAt),
        'Local title inference must leave the owner turn ahead of auxiliary work.')
    }

    return { nativeScheduling, deliveredAt, titleRequests }
  }
}

export default scenario
