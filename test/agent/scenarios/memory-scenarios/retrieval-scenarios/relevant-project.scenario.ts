import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const { MEMORY_MANAGER } = await import('@/core')
      await MEMORY_MANAGER.rememberExplicit('For project Caldera, the handoff contact is Mira and the review day is Tuesday.', { source: 'scenario-owner-evidence' })
      await MEMORY_MANAGER.rememberExplicit('For project Borealis, the handoff contact is Tomas and the review day is Friday.', { source: 'scenario-owner-evidence' })
      const turn = await context.runTurn('From my saved project information, who is responsible for the Caldera handoff, and which weekday is its review?')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.output.includes('Mira') && turn.output.includes('Tuesday'))
      assert.ok(!turn.output.includes('Tomas') && !turn.output.includes('Friday'))
      assert.ok(turn.executionHistory.some((execution) => execution.function === 'structured_knowledge.memory.read'))

      return { turn }
    })
  }
}

export default scenario
