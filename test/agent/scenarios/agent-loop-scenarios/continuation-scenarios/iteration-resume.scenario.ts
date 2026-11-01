import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { CONFIG_MANAGER } = await import('@/config')
      const runtime = CONFIG_MANAGER.getConfig().runtime
      const previousLimit = runtime.agent_max_iterations
      // The finishing reserve is inside this cap, so even dependent work must pause.
      runtime.agent_max_iterations = 6

      try {
        const first = await context.runTurn('Use the file tool for this ordered workflow. Write first.txt containing stage-one. After reading it back and observing its contents, write second.txt containing stage-two. After reading that back, write third.txt containing stage-three and read it back. Do not combine dependent reads and writes in one tool batch. Track the steps in a plan and complete every stage.')
        assert.notEqual(first.finalIntent, 'answer', first.output)
        const initial = await fs.readFile(path.join(workspace, 'first.txt'), 'utf8')
        const firstStat = await fs.stat(path.join(workspace, 'first.txt'))
        runtime.agent_max_iterations = previousLimit
        const second = await context.runTurn('Continue the same workflow from the saved verified progress. Complete and verify all remaining stages; no new approval is needed.', first.sessionId)
        assert.equal(second.finalIntent, 'answer', second.output)
        assert.equal(await fs.readFile(path.join(workspace, 'first.txt'), 'utf8'), initial)
        assert.equal((await fs.stat(path.join(workspace, 'first.txt'))).mtimeMs, firstStat.mtimeMs)
        assert.equal((await fs.readFile(path.join(workspace, 'second.txt'), 'utf8')).trim(), 'stage-two')
        assert.equal((await fs.readFile(path.join(workspace, 'third.txt'), 'utf8')).trim(), 'stage-three')

        return { first, second }
      } finally {
        runtime.agent_max_iterations = previousLimit
      }
    })
  }
}

export default scenario
