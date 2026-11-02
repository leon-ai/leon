import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { archiveSource, assertArchivedSourceCoverage, operatingNotes } from './fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const source = await archiveSource([
        'Here is the complete Caldera field-trial report for future reference.',
        'Opening findings: the trial covered 24 public libraries. Offline checkout succeeded at every site.',
        operatingNotes('Caldera field trial', 1, 24),
        'Midpoint finding: duplicate returns appeared after reconnection. An idempotency key removed the duplicates.',
        operatingNotes('Caldera field trial', 25, 24),
        'Closing decision: approve the pilot expansion only after staff training and a signed rollback checklist.'
      ])
      const turn = await context.runTurn('Give me a complete concise summary of the report I shared earlier: its findings, the problem and resolution, and the final decision.')
      assertArchivedSourceCoverage(turn, source)
      const answer = turn.output.toLowerCase()
      for (const value of ['24', 'librar', 'offline', 'duplicate', 'idempot', 'training', 'rollback']) {
        assert.ok(answer.includes(value), turn.output)
      }
      return { turn, source: { sessionId: source.sessionId, messageId: source.messageId } }
    })
  }
}

export default scenario
