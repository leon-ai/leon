import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { archiveSource } from '../session-recall-scenarios/fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      await archiveSource('My Aster internal project routing map: Falcon handles billing; Heron handles the customer portal. These names apply only within Aster.')
      await archiveSource('My Borealis internal project routing map: Falcon handles inventory; Heron handles billing. These names apply only within Borealis and do not change Aster.')
      const turn = await context.runTurn([
        'Use the internal project routing maps I supplied earlier to route these requests:',
        'aster_invoice: an Aster customer disputes an invoice.',
        'aster_portal: an Aster customer cannot sign into the customer portal.',
        'borealis_invoice: a Borealis customer disputes an invoice.',
        'borealis_inventory: a Borealis warehouse stock count is incorrect.',
        'Return only a JSON object with those four keys and the corresponding internal project name as each value.'
      ].join('\n'))
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.equal(turn.historyBeforeTurn, 0)
      assert.deepEqual(JSON.parse(turn.output), {
        aster_invoice: 'Falcon', aster_portal: 'Heron',
        borealis_invoice: 'Heron', borealis_inventory: 'Falcon'
      })
      assert.ok(turn.executionHistory.some((execution) =>
        execution.function === 'structured_knowledge.sessions.searchSessions'))
      return { turn }
    })
  }
}

export default scenario
