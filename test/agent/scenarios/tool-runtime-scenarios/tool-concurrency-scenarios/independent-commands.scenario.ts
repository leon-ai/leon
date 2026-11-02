import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    const workspace = path.join(profilePath, 'workspace')
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(path.join(workspace, 'measurement.mjs'), `
import fs from 'node:fs'
const startedAt = Date.now()
setTimeout(() => {
  fs.writeFileSync(process.argv[2], JSON.stringify({ startedAt, completedAt: Date.now() }))
  console.log('Measurement finished: ' + process.argv[2])
}, 1_000)
`)
  },
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const turn = await context.runTurn('Run node measurement.mjs first.json and node measurement.mjs second.json concurrently, using two separate shell.executeCommand tool calls in the same response. These independent commands write separate measurement files. Verify both completed and report the result.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      const measurements = await Promise.all(['first.json', 'second.json'].map(async (name) =>
        JSON.parse(await fs.readFile(path.join(workspace, name), 'utf8')) as {
          startedAt: number
          completedAt: number
        }
      ))
      assert.ok(Math.max(...measurements.map((item) => item.startedAt)) <
        Math.min(...measurements.map((item) => item.completedAt)),
      'Independent worker commands must actually overlap in execution.')
      assert.ok(turn.executionHistory.filter((execution) => execution.function === 'operating_system_control.shell.executeCommand').length >= 2)

      return { turn, measurements }
    })
  }
}

export default scenario
