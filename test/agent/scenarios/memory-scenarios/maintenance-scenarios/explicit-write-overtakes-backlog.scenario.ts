import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { persistentScenarioRecords } from '../fixture'
import { withLearningBacklog } from './fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { MEMORY_MANAGER } = await import('@/core')
      await MEMORY_MANAGER.rememberExplicit('Caldera handoff contact is Mira.')
      const evidence = await withLearningBacklog(context, workspace, async (run) => {
        await run('Caldera update: Nora has replaced Mira as handoff contact. Reply briefly without tools.')
        await run('Thanks. Reply briefly without tools.')
        const explicit = await run('Please remember this correction in persistent memory now: Tomas has replaced Nora and Mira as the current Caldera handoff contact. Replace the old contact record; this is an ongoing arrangement.')
        assert.equal(explicit.hasExplicitMemoryWrite, true, 'The explicit write must happen in the foreground.')
        const beforeRelease = await persistentScenarioRecords()
        assert.ok(beforeRelease.some((record) => String(record['content_md']).includes('Tomas')), 'The write must finish while learning is still blocked.')
      })
      const records = await persistentScenarioRecords()
      const contents = records.map((record) => String(record['content_md'])).join('\n')
      assert.ok(contents.includes('Tomas'), contents)
      assert.ok(!records.some((record) => record['source_type'] === 'inferred' && String(record['content_md']).includes('Nora')), contents)
      return { ...evidence, records }
    })
  }
}

export default scenario
