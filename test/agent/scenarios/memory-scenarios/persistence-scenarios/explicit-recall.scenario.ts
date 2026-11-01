import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const first = await context.runTurn('Remember this as a persistent project fact: the Caldera handoff contact is Mira, and its review day is Tuesday.')
      assert.equal(first.finalIntent, 'answer', first.output)
      assert.ok(first.executionHistory.some((execution) => execution.function === 'structured_knowledge.memory.write'))
      const second = await context.runTurn('Use your memory to tell me who handles the Caldera handoff and on which day it is reviewed.')
      assert.equal(second.finalIntent, 'answer', second.output)
      assert.equal(second.historyBeforeTurn, 0)
      assert.ok(second.output.includes('Mira') && second.output.includes('Tuesday'))
      assert.ok(second.executionHistory.some((execution) => execution.function === 'structured_knowledge.memory.read'))

      return { first, second }
    })
  }
}

export default scenario
