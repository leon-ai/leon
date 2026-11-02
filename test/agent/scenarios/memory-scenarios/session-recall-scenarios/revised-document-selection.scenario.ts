import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { archiveSource, assertArchivedSourceCoverage, operatingNotes } from './fixture'

const DAY_MS = 24 * 60 * 60 * 1_000
const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      await archiveSource('Caldera launch briefing, revision 1: launch owner Mira; launch date 11 December 2026; post-launch support lasts 30 days.', Date.now() - 2 * DAY_MS)
      const source = await archiveSource([
        'Here is revision 2 of the Caldera launch briefing. This is the current approved version and replaces revision 1.',
        'The launch owner is Nora.',
        operatingNotes('Caldera launch briefing revision 2', 1, 24),
        'The launch date is 18 December 2026.',
        operatingNotes('Caldera launch briefing revision 2', 25, 24),
        'The post-launch support period is 5 days.'
      ].join('\n\n'), Date.now() - DAY_MS)
      const turn = await context.runTurn('Summarize the complete current Caldera launch briefing I shared earlier, including launch owner, launch date and support period. Follow the version I designated current and do not combine drafts.')
      assertArchivedSourceCoverage(turn, source)
      const answer = turn.output.toLowerCase()
      for (const value of ['nora', '18', 'december', '2026', '5']) {
        assert.ok(answer.includes(value), turn.output)
      }
      assert.ok(!answer.includes('mira') && !answer.includes('30 days'), turn.output)
      return { turn, source: { sessionId: source.sessionId, messageId: source.messageId } }
    })
  }
}

export default scenario
