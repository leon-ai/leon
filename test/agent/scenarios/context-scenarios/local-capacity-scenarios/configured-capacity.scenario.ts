import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import automaticAllocation from './automatic-allocation.scenario'

const CONTEXT_TOKENS = 8_192

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    await automaticAllocation.prepareProfile!(profilePath)
    const { CONFIG_MANAGER } = await import('@/config')
    await CONFIG_MANAGER.setValue(['llm', 'providers', 'llamacpp', 'context_size'], CONTEXT_TOKENS)
  },
  async run({ runTurn }) {
    const { LLM_PROVIDER } = await import('@/core')
    const capacity = await LLM_PROVIDER.getAgentNativeContextWindowTokens()
    assert.equal(capacity, CONTEXT_TOKENS)
    const turn = await runTurn('Reply with exactly READY. Do not use tools.')
    assert.equal(turn.finalIntent, 'answer', turn.output)
    assert.ok(turn.output.includes('READY'), turn.output)

    return { capacity, turn }
  }
}

export default scenario
