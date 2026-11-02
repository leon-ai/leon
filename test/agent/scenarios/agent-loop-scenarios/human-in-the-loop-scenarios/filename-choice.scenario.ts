import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const CONTENT = 'The field inspection is complete.'
const FILENAME = 'inspection-result.txt'

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    await fs.mkdir(path.join(profilePath, 'workspace'), { recursive: true })
  },

  async run({ profilePath, runTurn }) {
    const workspace = path.join(profilePath, 'workspace')
    const previousWorkspace = process.cwd()
    process.chdir(workspace)

    try {
      const first = await runTurn(`Create a text file in this workspace containing exactly: ${CONTENT} You must ask me which filename to use before creating it.`)
      assert.equal(first.finalIntent, 'clarification', first.output)
      assert.equal((await fs.readdir(workspace)).filter((name) => name.endsWith('.txt')).length, 0)
      const second = await runTurn(`Use ${FILENAME}.`, first.sessionId)
      assert.equal(second.finalIntent, 'answer', second.output)
      assert.equal(second.sessionId, first.sessionId)
      assert.ok(second.historyBeforeTurn >= 2)
      assert.equal((await fs.readFile(path.join(workspace, FILENAME), 'utf8')).trim(), CONTENT)

      return { first, second }
    } finally {
      process.chdir(previousWorkspace)
    }
  }
}

export default scenario
