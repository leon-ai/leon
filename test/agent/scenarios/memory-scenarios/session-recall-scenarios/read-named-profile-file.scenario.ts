import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const FILENAME = 'inspection-notes.md'
const FIRST_LINES = [
  'Site: North Dock',
  'Inspector: Celia Trent',
  'Batch: QUARTZ-81',
  'Gate: West entrance',
  'Review: Thursday'
]
const LATER_LINE = 'Archive reference: EMBER-62'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const content = [...FIRST_LINES, LATER_LINE].join('\n')
      const filename = path.join(context.profilePath, 'files', FILENAME)
      const created = await context.runTurn(
        `Save ${FILENAME} as an editable file so we can return to it later. Use exactly these lines:\n${content}`
      )
      assert.equal(created.finalIntent, 'answer', created.output)
      assert.equal((await fs.readFile(filename, 'utf8')).trim(), content)

      const turn = await context.runTurn(`Show me the first five lines of the ${FILENAME} file you saved earlier.`)
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.equal(turn.historyBeforeTurn, 0)
      assert.equal(turn.executionHistory[0]?.function, 'file_system.file.read')
      assert.equal(turn.executionHistory[0]?.status, 'success')
      for (const line of FIRST_LINES) {
        assert.ok(turn.output.includes(line), turn.output)
      }
      assert.ok(!turn.output.includes(LATER_LINE), turn.output)

      await fs.rename(filename, path.join(context.profilePath, FILENAME))
      const existing = await context.runTurn(`What is the batch code in ${FILENAME}, the file you saved for me?`)
      assert.equal(existing.historyBeforeTurn, 0)
      assert.equal(existing.finalIntent, 'answer', existing.output)
      assert.ok(existing.output.includes('QUARTZ-81'), existing.output)

      return { created, turn, existing }
    })
  }
}

export default scenario
