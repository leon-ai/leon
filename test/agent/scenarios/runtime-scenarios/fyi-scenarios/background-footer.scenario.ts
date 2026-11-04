import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run({ runTurn }) {
    const { runTurnLifecycle } = await import('@/core/turn-lifecycle')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
    const { POST_TURN_MAINTENANCE_QUEUE } = await import('@/core')
    const { readInferenceUsage } = await import('@/core/llm-manager/llm-usage/usage-ledger')
    const { InferencePurpose } = await import('@/core/llm-manager/types')
    const { TurnStage } = await import('@/core/llm-manager/turn-timing')
    const { FyiKind, isFyiEligible } = await import('@/core/fyi/fyi-contract')
    const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
    const turnId = randomUUID()
    const query = 'Briefly explain why the sky looks blue during the day. Do not use tools.'
    let delivered = false
    let messageId = ''
    let acceptedAnswer = ''
    let published = false

    await runTurnLifecycle({ sessionId, turnId, query, onFyi: (fyi, id) => {
      assert.equal(delivered, true)
      assert.equal(id, messageId)
      assert.ok(fyi.text.trim())
      published = true
    } }, async () => {
      const turn = await runTurn(query, sessionId)
      acceptedAnswer = turn.output
      messageId = turn.responseTrace.id
      delivered = true
      return {
        output: turn.output, data: {
          finalIntent: turn.finalIntent, executionHistory: turn.executionHistory,
          agentResponseTrace: turn.responseTrace
        }
      } as unknown as import('@/core/llm-manager/llm-duty').LLMDutyResult
    })
    assert.ok(acceptedAnswer.trim())
    assert.equal(published, false)
    const before = CONVERSATION_REPOSITORY.readMessage(sessionId, messageId)!
    await POST_TURN_MAINTENANCE_QUEUE.whenIdle()
    const after = CONVERSATION_REPOSITORY.readMessage(sessionId, messageId)!
    assert.equal(after.message, acceptedAnswer)
    assert.equal(after.sentAt, before.sentAt)
    const usage = []
    for await (const record of readInferenceUsage({ turnId })) {
      usage.push(record)
    }
    const fyiUsage = usage.filter((record) => record.purpose === InferencePurpose.Fyi)
    assert.ok(fyiUsage.length <= 1)
    if (isFyiEligible(acceptedAnswer)) {
      assert.equal(published, true)
      assert.ok(after.fyi?.text)
      assert.ok([...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(after.fyi.text)].length <= 2)
      if (after.fyi.kind !== FyiKind.Vision) {
        assert.equal(fyiUsage.length, 1)
      }
    } else {
      assert.equal(published, false)
      assert.equal(after.fyi, undefined)
      assert.equal(fyiUsage.length, 0)
    }
    assert.ok(fyiUsage.every((record) => record.stage === TurnStage.PostTurn &&
      record.sessionId === sessionId && record.taskId))
    return { sessionId, turnId, messageId, fyi: after.fyi, usage }
  }
}

export default scenario
