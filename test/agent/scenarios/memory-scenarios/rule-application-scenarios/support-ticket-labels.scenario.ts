import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { archiveSource } from '../session-recall-scenarios/fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      await archiveSource([
        'My Aster support ticket classification examples for future use:',
        '"I was charged twice for one order" => 7.',
        '"The application crashes when I open it" => 12.',
        '"Cancel my subscription" => 19.',
        'These are our internal numerical labels; infer the matching category from the examples. Use null when a ticket does not fit any demonstrated category.'
      ].join('\n'))
      const turn = await context.runTurn([
        'Use my previously supplied Aster support classification examples to label these new tickets:',
        '1. My card shows two identical debits for a single purchase.',
        '2. The desktop client exits immediately every time I launch it.',
        '3. Please end my subscription before its next renewal.',
        '4. What is your office postal address?',
        'Return only a JSON array of four numerical labels or null, in ticket order.'
      ].join('\n'))
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.equal(turn.historyBeforeTurn, 0)
      assert.deepEqual(JSON.parse(turn.output), [7, 12, 19, null])
      assert.ok(turn.executionHistory.some((execution) =>
        execution.function === 'structured_knowledge.sessions.searchSessions'))
      return { turn }
    })
  }
}

export default scenario
