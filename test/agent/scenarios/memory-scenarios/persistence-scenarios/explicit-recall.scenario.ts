import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const first = await runMaintainedTurn(context,
        'Remember this as a persistent project fact: the Caldera handoff contact is Mira, and its review day is Tuesday.',
        workspace)
      assert.ok(first.executionHistory.some((execution) => execution.function === 'structured_knowledge.memory.write'))
      const second = await runMaintainedTurn(context,
        'Use your memory to tell me who handles the Caldera handoff and on which day it is reviewed.',
        workspace)
      assert.equal(second.historyBeforeTurn, 0)
      assert.ok(second.output.includes('Mira') && second.output.includes('Tuesday'))
      assert.ok(second.executionHistory.some((execution) => execution.function === 'structured_knowledge.memory.read'))

      return { first, second }
    })
  }
}

export default scenario
