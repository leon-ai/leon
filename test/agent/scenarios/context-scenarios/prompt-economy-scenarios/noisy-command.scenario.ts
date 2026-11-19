import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn } from '../../scenario-fixture'

const COMMAND = 'node verify.mjs'
const CHECKED_COUNT = 37
const DIAGNOSTIC = '[check] Source map matches generated asset; no action needed.'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      await fs.writeFile(path.join(workspace, 'verify.mjs'), [
        `for (let index = 0; index < 360; index++) console.log(${JSON.stringify(DIAGNOSTIC)})`,
        `console.log('Verification passed for ${CHECKED_COUNT} assets.')`
      ].join('\n'))

      const turn = await runMaintainedTurn(context,
        `Run \`${COMMAND}\` in the current directory using a single shell.executeCommand call, then report its final verification line. That's the only check I need.`,
        workspace)
      assert.ok(turn.output.match(/\b\d+\b/g)?.includes(String(CHECKED_COUNT)), turn.output)
      assert.match(turn.output, /\b(?:pass(?:ed)?|success(?:ful(?:ly)?)?|succeeded|verified)\b/i)
      const commands = turn.executionHistory.filter((entry) =>
        entry.function === 'operating_system_control.shell.executeCommand' &&
        entry.requestedToolInput?.includes(COMMAND)
      )
      assert.equal(commands.length, 1, 'Run the check once using the finite command tool.')
      assert.equal(commands[0]?.status, 'success')
      assert.equal(turn.toolCalls.length, 1, 'The command output must provide the requested result.')

      return { turn }
    })
  }
}

export default scenario
