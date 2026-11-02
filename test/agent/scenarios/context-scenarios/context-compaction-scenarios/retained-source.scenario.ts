import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const rows = Array.from({ length: 3_000 }, (_, index) => ({ id: index, note: 'Background measurement for the retained inspection record.' }))
      rows[1_450] = { id: 1_450, note: 'The handoff token is SPRUCE-926.' }
      await fs.writeFile(path.join(workspace, 'inspection.json'), JSON.stringify(rows))
      const turn = await context.runTurn('Read inspection.json once with file.read and options.maxChars=400000. It is deliberately too large for inline context. Use the returned retained execution id with tool_executions to find the handoff token without rereading the source or using shell. Tell me that token.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.output.includes('SPRUCE-926'))
      assert.equal(turn.executionHistory.filter((entry) => entry.function === 'file_system.file.read').length, 1)
      assert.ok(turn.executionHistory.some((entry) => entry.function === 'system_utilities.tool_executions.read'))
      assert.ok(!turn.executionHistory.some((entry) => entry.function.startsWith('operating_system_control.')))
      const state = JSON.parse(await fs.readFile(path.join(context.profilePath, 'sessions', turn.sessionId, '.agent-conversation-state.json'), 'utf8'))
      const source = state.transcript.filter((message: { role: string, toolName?: string }) => message.role === 'tool' && message.toolName?.endsWith('__read'))
      assert.ok(source.length > 0)
      assert.ok(source.every((message: { content: string }) => message.content.length < 35_000), 'The complete oversized source must stay outside the prompt.')

      return { turn, sourceRows: rows.length }
    })
  }
}

export default scenario
