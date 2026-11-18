import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn, scenarioWeather } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  toolResult: scenarioWeather,
  async run(context) {
    const { CONFIG_MANAGER } = await import('@/config')
    CONFIG_MANAGER.getConfig().runtime.progressive_toolkit_loading = true
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const turn = await runMaintainedTurn(context,
        'What is the current weather in Shenzhen? Just temperature and conditions.',
        workspace)

      assert.match(turn.output, /18/)
      assert.equal(turn.executionHistory.length, 1)
      assert.equal(turn.executionHistory[0]?.function, 'weather.openmeteo.getWeather')

      return { turn }
    })
  }
}

export default scenario
