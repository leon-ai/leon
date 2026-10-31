import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RealAgentScenario } from '../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run({ profilePath, runTurn }) {
    const { runTurnLifecycle } = await import('@/core/turn-lifecycle')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const { POST_TURN_MAINTENANCE_QUEUE } = await import('@/core')
    const { readTurnHistory, TurnStage } = await import('@/core/llm-manager/turn-timing')
    const { readInferenceUsage } = await import('@/core/llm-manager/llm-usage/usage-ledger')
    const { InferencePurpose } = await import('@/core/llm-manager/types')
    const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
    const turnId = randomUUID()
    const query = 'I live in Haarlem, Netherlands. This is my home city, rather than a travel destination. Reply briefly acknowledging this information. Do not use tools.'
    let answer = ''
    let foregroundFinishedAt = 0
    await runTurnLifecycle({ sessionId, turnId, query }, async () => {
      const result = await runTurn(query, sessionId)
      answer = result.output
      foregroundFinishedAt = Date.now()
      return {
        output: answer,
        data: { finalIntent: result.finalIntent, executionHistory: result.executionHistory }
      } as unknown as import('@/core/llm-manager/llm-duty').LLMDutyResult
    })
    assert.ok(answer.trim())
    await POST_TURN_MAINTENANCE_QUEUE.whenIdle()
    assert.equal(CONVERSATION_SESSION_MANAGER.getSession(sessionId)?.isTitleGenerated, true)
    const history = []
    for await (const record of readTurnHistory({ turnId })) {
      history.push(record)
    }
    assert.ok(history.some((record) => record['task'] === 'session title generation' && record['outcome'] === 'completed'))
    const usage = []
    for await (const record of readInferenceUsage({ turnId })) {
      usage.push(record)
    }
    assert.ok(usage.some((record) => record.purpose === InferencePurpose.SessionTitle && record.stage === TurnStage.PreTurn))
    assert.ok(usage.find((record) => record.purpose === InferencePurpose.SessionTitle)!.startedAt <= foregroundFinishedAt)
    assert.ok(usage.some((record) => record.purpose === InferencePurpose.Memory && record.stage === TurnStage.PostTurn))
    assert.ok(usage.every((record) => record.sessionId === sessionId))
    assert.ok(usage.filter((record) => record.purpose === InferencePurpose.SessionTitle || record.stage === TurnStage.PostTurn)
      .every((record) => record.taskId))
    assert.ok(usage.some((record) => (record.usage.inputTokens ?? 0) > 0))
    const dailyPath = path.join(profilePath, 'memory', 'daily')
    const daily = (await Promise.all((await fs.readdir(dailyPath)).map((file) => fs.readFile(path.join(dailyPath, file), 'utf8')))).join('\n')
    assert.ok(daily.includes('Haarlem'))
    return { sessionId, turnId, title: CONVERSATION_SESSION_MANAGER.getSession(sessionId)?.title, usage, history }
  }
}

export default scenario
