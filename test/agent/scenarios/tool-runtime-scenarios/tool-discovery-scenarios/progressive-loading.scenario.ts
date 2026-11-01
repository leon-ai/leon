import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, scenarioWeather } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  toolResult: scenarioWeather,
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { CONFIG_MANAGER } = await import('@/config')
      CONFIG_MANAGER.getConfig().runtime.progressive_toolkit_loading = true
      const turn = await context.runTurn('Use the weather tool to check current conditions in Oslo, Norway and Bergen, Norway. Save the city names and temperatures in comparison.txt in this workspace, then read the file to verify it.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      const content = await fs.readFile(path.join(workspace, 'comparison.txt'), 'utf8')
      assert.ok(content.includes('Oslo') && content.includes('Bergen') && content.includes('18'))
      const state = JSON.parse(await fs.readFile(path.join(
        context.profilePath, 'sessions', turn.sessionId, '.agent-conversation-state.json'
      ), 'utf8')) as { loadedToolkitIds: string[], loadedFunctionNames: string[] }
      assert.ok(state.loadedToolkitIds.includes('weather'))
      assert.ok(state.loadedToolkitIds.includes('file_system'))
      assert.ok(state.loadedFunctionNames.includes('weather.openmeteo.getWeather'))
      const calls = turn.executionHistory.filter((execution) => execution.function === 'weather.openmeteo.getWeather')
      assert.equal(calls.length, 2)

      return { turn, state }
    })
  }
}

export default scenario
