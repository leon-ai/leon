import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { persistentScenarioRecords } from '../fixture'
import { withLearningBacklog } from './fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const evidence = await withLearningBacklog(context, workspace, async (run) => {
        await run('My permanent office is now in Utrecht. I work there every Monday and Wednesday. Reply briefly without tools.')
        await run('Thanks, that is all for now. Reply briefly without tools.')
        await run('One more ongoing detail: my Borealis review is every Thursday at 14:00. Reply briefly without tools.')
      })
      const records = await persistentScenarioRecords()
      const contents = records.map((record) => String(record['content_md'])).join('\n')
      assert.ok(contents.includes('Utrecht') && contents.includes('Monday') && contents.includes('Wednesday'), contents)
      assert.ok(contents.includes('Borealis') && contents.includes('Thursday') && contents.includes('14:00'), contents)
      assert.ok(!contents.toLowerCase().includes('thanks'), contents)
      return { ...evidence, records }
    })
  }
}

export default scenario
