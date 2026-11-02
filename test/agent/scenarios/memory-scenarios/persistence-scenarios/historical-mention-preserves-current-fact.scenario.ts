import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn } from '../../scenario-fixture'
import { assertMemoryRecall, persistentScenarioRecords } from '../fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { MEMORY_MANAGER } = await import('@/core')
      const old = await MEMORY_MANAGER.rememberExplicit('Caldera handoff contact is Mira.', { source: 'scenario-owner-evidence' })
      const update = await runMaintainedTurn(context,
        'Nora has replaced Mira as the Caldera handoff contact. Please reply briefly without using any tools.', workspace)
      assert.equal(update.hasExplicitMemoryWrite, false)
      const current = await persistentScenarioRecords()
      assert.ok(!current.some((record) => record['id'] === old.id))
      const contact = current.find((record) => String(record['content_md']).includes('Nora'))
      assert.ok(contact)
      const history = await runMaintainedTurn(context,
        'I was reading last year’s Caldera notes: Mira was our handoff contact then and handled the old launch. This is historical background, not a change to the current contact. Please reply briefly without using any tools.', workspace)
      assert.equal(history.hasExplicitMemoryWrite, false)
      const records = await persistentScenarioRecords()
      assert.ok(records.some((record) => record['id'] === contact['id'] &&
        record['content_md'] === contact['content_md']))
      const turn = await context.runTurn('Who handles the Caldera handoff now? Distinguish the current contact from the person in our historical notes. Use saved memory.')
      assertMemoryRecall(turn)
      assert.ok(turn.output.includes('Nora'), turn.output)
      assert.ok(!/current (?:contact|handoff contact) is Mira/i.test(turn.output), turn.output)
      return { update, history, turn, records }
    })
  }
}

export default scenario
