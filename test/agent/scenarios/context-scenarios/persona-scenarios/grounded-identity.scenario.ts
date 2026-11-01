import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const turn = await context.runTurn('Introduce yourself and what you help me do in one short first-person sentence. Keep it practical, without discussing mood or implementation machinery.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.output.includes('Leon'))
      assert.ok(turn.output.includes('I ' ) || turn.output.includes('I\'m') || turn.output.includes('I’m'))
      assert.ok(turn.output.length < 400)
      assert.equal(turn.executionHistory.length, 0)

      return { turn }
    })
  }
}

export default scenario
