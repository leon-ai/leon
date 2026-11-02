import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const first = await context.runTurn('Create authorized.txt containing deadline-resumed and verify it.', undefined, {
        deadlineAt: Date.now() - 1
      })
      assert.notEqual(first.finalIntent, 'answer', first.output)
      assert.equal(first.executionHistory.length, 0)
      assert.equal(await fs.stat(path.join(workspace, 'authorized.txt')).then(() => true, () => false), false)
      const second = await context.runTurn('Continue the same authorized task and verify the file.', first.sessionId)
      assert.equal(second.finalIntent, 'answer', second.output)
      assert.equal((await fs.readFile(path.join(workspace, 'authorized.txt'), 'utf8')).trim(), 'deadline-resumed')

      return { first, second }
    })
  }
}

export default scenario
