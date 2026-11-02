import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const SOURCE = 'Project: Caldera\nOwner: Mira\nStatus: draft\nBudget: 7300\n'
const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      await fs.writeFile(path.join(workspace, 'handoff.txt'), SOURCE)
      const turn = await context.runTurn('Use the file tool to change only Status: draft to Status: ready in handoff.txt. Preserve every other byte. Read the result to verify it.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.equal(await fs.readFile(path.join(workspace, 'handoff.txt'), 'utf8'), SOURCE.replace('Status: draft', 'Status: ready'))
      assert.ok(turn.executionHistory.some((entry) => entry.function === 'file_system.file.patch'))

      return { turn }
    })
  }
}

export default scenario
