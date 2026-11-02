import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const CODE = 'SPRUCE-72'
const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const first = await context.runTurn(`Create cobalt-brief.txt in this workspace containing the project codename ${CODE}. Confirm the exact filename and codename.`)
      assert.equal(first.finalIntent, 'answer', first.output)
      assert.ok((await fs.readFile(path.join(workspace, 'cobalt-brief.txt'), 'utf8')).includes(CODE))
      const second = await context.runTurn('Search our prior conversations for the Cobalt brief. What exact filename did you create, and what project codename did we use? Answer from the archived conversation rather than rediscovering files.')
      assert.equal(second.finalIntent, 'answer', second.output)
      assert.equal(second.historyBeforeTurn, 0)
      assert.ok(second.output.includes('cobalt-brief.txt') && second.output.includes(CODE))
      assert.ok(second.executionHistory.some((execution) => execution.function === 'structured_knowledge.sessions.searchSessions'))

      return { first, second }
    })
  }
}

export default scenario
