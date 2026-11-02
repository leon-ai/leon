import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { archiveSource, assertArchivedSourceCoverage, operatingNotes } from './fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const source = await archiveSource([
        'Here is the complete Cedar service agreement. Only clauses A, B and C impose obligations; the operating records are nonbinding context.',
        'Clause A: The supplier must notify the customer within 12 hours of a security incident.',
        operatingNotes('Cedar agreement schedule', 1, 24),
        'Clause B: The customer must export a backup every Friday.',
        operatingNotes('Cedar agreement schedule', 25, 24),
        'Clause C: The supplier must delete exported copies within 21 days after termination.'
      ].join('\n\n'))
      await archiveSource('The unrelated Rowan agreement allows 48 hours for incident notifications. It does not govern Cedar.')
      const turn = await context.runTurn('From the Cedar service agreement I supplied earlier, list every contractual obligation, who is responsible, and its deadline or frequency. Inspect the full agreement and keep unrelated agreements out.')
      assertArchivedSourceCoverage(turn, source)
      const answer = turn.output.toLowerCase()
      for (const value of ['supplier', 'customer', '12', 'incident', 'friday', 'backup', '21', 'delet', 'termination']) {
        assert.ok(answer.includes(value), turn.output)
      }
      assert.ok(!/48[ -]*(?:hours?|hrs?)/i.test(turn.output) && !answer.includes('rowan'), turn.output)
      return { turn, source: { sessionId: source.sessionId, messageId: source.messageId } }
    })
  }
}

export default scenario
