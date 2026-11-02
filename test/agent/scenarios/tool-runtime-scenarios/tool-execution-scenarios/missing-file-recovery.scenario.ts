import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      await fs.writeFile(path.join(workspace, 'handoff-actual.txt'), 'Handoff token: SPRUCE-84')
      const turn = await context.runTurn('First try reading handoff.txt using the file tool. If it is missing, inspect filenames in this workspace and find the actual handoff file. Tell me its exact token. Do not invent the contents or repeat the same failing read.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.output.includes('SPRUCE-84'))
      assert.ok(turn.executionHistory.some((execution) => execution.status === 'error'))
      assert.ok(turn.executionHistory.some((execution) => execution.function === 'file_system.file.read' && execution.status === 'success'))
      assert.equal(await fs.readFile(path.join(workspace, 'handoff-actual.txt'), 'utf8'), 'Handoff token: SPRUCE-84')

      return { turn }
    })
  }
}

export default scenario
