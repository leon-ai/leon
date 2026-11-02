import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const ITEMS = [
  { id: 'alpha', text: 'The first inspection passed.' },
  { id: 'beta', text: 'The second inspection passed.' },
  { id: 'gamma', text: 'The third inspection needs a follow-up.' }
]

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    const workspace = path.join(profilePath, 'workspace')
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(path.join(workspace, 'items.json'), JSON.stringify(ITEMS))
    await fs.writeFile(path.join(workspace, 'job.md'), [
      'Read items.json and enumerate every item before processing the collection.',
      'Write one <id>.txt file per item, containing exactly its text.',
      'Write manifest.json as a JSON array of all processed ids, in the original order.',
      'Read back every output and verify it against the input before completing the plan.'
    ].join('\n'))
  },
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const turn = await context.runTurn('Start a plan before reading job.md, initially covering reading the job and executing it. Then complete its instructions. Add a separate plan step for each discovered requirement as you learn it, and track collection coverage and verified outcomes.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      for (const item of ITEMS) {
        assert.equal((await fs.readFile(path.join(workspace, `${item.id}.txt`), 'utf8')).trim(), item.text)
      }
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(workspace, 'manifest.json'), 'utf8')), ITEMS.map((item) => item.id))
      const plan = turn.responseTrace.planSteps
      assert.ok(plan.length >= 3, 'Discovering the worklist must expand the initial plan.')
      assert.ok(plan.every((step) => step.status === 'completed'))
      assert.ok((turn.responseTrace.planTransitions?.length ?? 0) > plan.length)

      return { turn }
    })
  }
}

export default scenario
