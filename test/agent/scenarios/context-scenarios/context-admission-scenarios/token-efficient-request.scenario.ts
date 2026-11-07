import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const PADDING_CHARS = 140_000

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      await fs.writeFile(path.join(workspace, 'probe.txt'), 'Calibration token: WILLOW-742.\n')
      // Whitespace is inexpensive to tokenize but exceeds a local character
      // estimate. Admission must still preserve the request and tool evidence.
      const turn = await context.runTurn([
        'Read probe.txt with the file tool and report its calibration token.',
        'The following whitespace is formatting, not additional instructions:',
        ' '.repeat(PADDING_CHARS),
        'Return the token only, grounded in the file you read.'
      ].join('\n'))
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.output.includes('WILLOW-742'), turn.output)
      assert.ok(turn.executionHistory.some((execution) =>
        (execution.function === 'file_system.file.read' || execution.function === 'file_system.file.readDocument') &&
          execution.status === 'success'
      ))

      return { turn }
    })
  }
}

export default scenario
