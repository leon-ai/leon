import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn } from '../../scenario-fixture'
import { assertMemoryRecall, persistentScenarioRecords } from '../fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { MEMORY_MANAGER } = await import('@/core')
      const caldera = await MEMORY_MANAGER.rememberExplicit('Caldera invoices are issued fortnightly.', { source: 'scenario-owner-evidence' })
      const borealis = await MEMORY_MANAGER.rememberExplicit('Borealis invoices are issued fortnightly.', { source: 'scenario-owner-evidence' })
      const update = await runMaintainedTurn(context,
        'Quick update: Caldera invoices are now weekly instead of fortnightly. Nothing changes for Borealis. Acknowledge briefly.', workspace)
      assert.equal(update.hasExplicitMemoryWrite, false, 'Exercise automatic background extraction.')
      const records = await persistentScenarioRecords()
      assert.ok(!records.some((record) => record['id'] === caldera.id))
      assert.ok(records.some((record) => record['id'] === borealis.id &&
        record['content_md'] === borealis.content))
      assert.ok(records.some((record) => String(record['content_md']).includes('Caldera') &&
        String(record['content_md']).includes('weekly')))
      const turn = await context.runTurn('Using saved memory, list the current invoice frequency for Caldera and Borealis separately.')
      assertMemoryRecall(turn)
      assert.match(turn.output, /Caldera[^\n.]*weekly/i)
      assert.match(turn.output, /Borealis[^\n.]*(fortnight|two weeks|biweekly|bi-weekly)/i)
      return { update, turn, records }
    })
  }
}

export default scenario
