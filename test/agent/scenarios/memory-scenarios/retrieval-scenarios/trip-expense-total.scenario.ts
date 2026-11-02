import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { assertMemoryRecall, seedMemoryConversations } from '../fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      await seedMemoryConversations([
        'For my Caldera work trip, train receipt C-101 cost EUR 180. The Borealis train receipt B-201 cost EUR 90.',
        'Caldera work trip hotel receipt C-102: EUR 420.',
        'Caldera work trip taxi receipt C-103: EUR 45.',
        'I found another copy of Caldera hotel receipt C-102 for EUR 420. This is the same hotel expense, not another payment.'
      ])
      const turn = await context.runTurn('What was the total cost in EUR of my Caldera work trip? List the distinct expenses and the total from our earlier conversations.')
      assertMemoryRecall(turn)
      for (const amount of ['180', '420', '45', '645']) {
        assert.ok(turn.output.includes(amount), turn.output)
      }
      assert.ok(!turn.output.includes('1065') && !turn.output.includes('1,065'), turn.output)
      return { turn }
    })
  }
}

export default scenario
