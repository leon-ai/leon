import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn } from '../../scenario-fixture'

const SCRIPT_NAME = 'verify.mjs'
const COMMAND = `node ${SCRIPT_NAME}`
const CHECKED_COUNT = 37
const DIAGNOSTIC = '[check] Source map matches generated asset; no action needed.'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const scriptPath = path.resolve(workspace, SCRIPT_NAME)

      await fs.writeFile(scriptPath, [
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
      const { toolCalls } = turn
      assert.ok(toolCalls.length <= 2, 'Allow at most one script read before running the check.')
      const commandCall = toolCalls.at(-1)
      assert.equal(commandCall?.toolkitId, 'operating_system_control')
      assert.equal(commandCall?.toolId, 'shell')
      assert.equal(commandCall?.functionName, 'executeCommand')
      if (toolCalls.length === 2) {
        const [read] = toolCalls
        const readPath = read?.parsedInput?.['path']
        assert.ok(
          read?.toolkitId === 'file_system' && read.toolId === 'file' && read.functionName === 'read' &&
            typeof readPath === 'string' && path.resolve(workspace, readPath) === scriptPath,
          'Only a read of the verification script may precede the command.'
        )
      }

      return { turn }
    })
  }
}

export default scenario
