import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { persistentScenarioRecords } from '../fixture'
import { withLearningBacklog } from './fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { MEMORY_MANAGER } = await import('@/core')
      await MEMORY_MANAGER.rememberExplicit('Caldera handoff contact is Mira. The review is on Tuesday.')
      const evidence = await withLearningBacklog(context, workspace, async (run) => {
        await run('Quick update: Nora has replaced Mira as the Caldera handoff contact. The Tuesday review is unchanged. Reply briefly without tools.')
        await run('Borealis invoices are now paid every Friday. That is our ongoing billing schedule. Reply briefly without tools.')
        await run('Final Caldera update: Tomas has replaced Nora as handoff contact. The Tuesday review is still unchanged. Reply briefly without tools.')
      })
      const records = await persistentScenarioRecords()
      const contents = records.map((record) => String(record['content_md'])).join('\n')
      assert.ok(contents.includes('Tomas') && contents.includes('Tuesday'), contents)
      assert.ok(contents.includes('Borealis') && contents.includes('Friday'), contents)
      assert.ok(!contents.includes('Nora') && !contents.includes('Mira'), contents)
      assert.ok(records.every((record) => String(record['source_ref']).includes(`session:${evidence['sessionId']}:turn:`)))
      return { ...evidence, records }
    })
  }
}

export default scenario
