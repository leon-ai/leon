import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const turn = await context.runTurn('Read your ARCHITECTURE.md context file through the context tool. According to that file, how do you handle tool outputs too large to fit in the model context? Answer briefly from that source.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.executionHistory.some((execution) => execution.function === 'structured_knowledge.context.readContextFile' &&
        execution.requestedToolInput?.includes('ARCHITECTURE.md')))
      assert.ok(!turn.executionHistory.some((execution) => execution.function.startsWith('operating_system_control.')))
      assert.ok(turn.output.toLowerCase().includes('artifact') || turn.output.toLowerCase().includes('retained'))

      return { turn }
    })
  }
}

export default scenario
