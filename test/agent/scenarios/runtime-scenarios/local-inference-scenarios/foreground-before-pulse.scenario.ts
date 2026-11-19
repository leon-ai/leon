import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run({ runTurn }) {
    const { LLM_PROVIDER } = await import('@/core')
    const { runInference } = await import('@/core/llm-manager/inference')
    const { InferencePurpose } = await import('@/core/llm-manager/types')
    const nativeScheduling = Boolean(await LLM_PROVIDER.getAgentNativeContextWindowTokens())
    if (!nativeScheduling) {
      return { nativeScheduling }
    }
    let deliveredAt = 0
    let pulseCompletedAt = 0
    let pulse: ReturnType<typeof runInference> | undefined
    try {
      await LLM_PROVIDER.runForegroundTurn(async () => {
        pulse = runInference({
          usagePurpose: InferencePurpose.PulsePlanning,
          prompt: 'Return exactly {"items":[]}.', disableThinking: true, maxTokens: 32
        }).then((result) => {
          pulseCompletedAt = Date.now()
          return result
        })
        const turn = await runTurn('Reply with exactly READY. Do not use tools.')
        assert.equal(turn.finalIntent, 'answer', turn.output)
        assert.equal(pulseCompletedAt, 0, 'Pulse planning must remain queued through answer delivery.')
        deliveredAt = Date.now()
      })
    } finally {
      // Drain the auxiliary request even when the owner turn fails.
      await pulse
    }
    assert.ok(pulseCompletedAt >= deliveredAt)

    return { nativeScheduling, deliveredAt, pulseCompletedAt }
  }
}

export default scenario
