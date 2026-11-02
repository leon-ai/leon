import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { archiveSource } from '../session-recall-scenarios/fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      await archiveSource([
        'My Aster hotel reimbursement policy:',
        'Hotel expenses of EUR 150 per night or less qualify for reimbursement.',
        'An expense above that limit qualifies only with written preapproval.',
        'A missing receipt always makes an expense ineligible, including preapproved expenses.',
        'Examples: EUR 150 with a receipt needs no preapproval. EUR 180 with a receipt and written preapproval qualifies. EUR 135 without a receipt does not qualify.'
      ].join('\n'))
      const turn = await context.runTurn([
        'Apply my previously supplied Aster hotel reimbursement policy to these claims:',
        'A: EUR 150 for one night, receipt present, no preapproval.',
        'B: EUR 151 for one night, receipt present, no preapproval.',
        'C: EUR 185 for one night, receipt present, written preapproval present.',
        'D: EUR 120 for one night, no receipt, written preapproval present.',
        'Return only a JSON object with keys A, B, C and D; each value must be "approved" or "rejected".'
      ].join('\n'))
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.equal(turn.historyBeforeTurn, 0)
      assert.deepEqual(JSON.parse(turn.output), {
        A: 'approved', B: 'rejected', C: 'approved', D: 'rejected'
      })
      assert.ok(turn.executionHistory.some((execution) =>
        execution.function === 'structured_knowledge.sessions.searchSessions'))
      return { turn }
    })
  }
}

export default scenario
