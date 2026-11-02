import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn } from '../../scenario-fixture'
import { assertMemoryRecall, persistentScenarioRecords } from '../fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { MEMORY_MANAGER } = await import('@/core')
      const old = await MEMORY_MANAGER.rememberExplicit('Caldera handoff contact is Mira. The review is on Tuesday.', { source: 'scenario-owner-evidence' })
      const update = await runMaintainedTurn(context,
        'Quick update: Nora has replaced Mira as the Caldera handoff contact. The Tuesday review is unchanged. Please reply briefly without using any tools.', workspace)
      assert.equal(update.hasExplicitMemoryWrite, false, 'Exercise automatic background extraction.')
      const records = await persistentScenarioRecords()
      assert.ok(!records.some((record) => record['id'] === old.id))
      assert.ok(records.some((record) => String(record['content_md']).includes('Nora')))
      const turn = await context.runTurn('Who is my current Caldera handoff contact and which day is the review? Use saved memory.')
      assertMemoryRecall(turn)
      assert.ok(turn.output.includes('Nora') && turn.output.includes('Tuesday'), turn.output)
      return { update, turn, records }
    })
  }
}

export default scenario
