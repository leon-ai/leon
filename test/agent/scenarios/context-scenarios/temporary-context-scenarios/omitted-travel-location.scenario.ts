import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, scenarioWeather } from '../../scenario-fixture'
import { assertOmittedTemporaryRecall, omitFromTemporarySnapshot, prepareOmittedTemporaryProfile, rememberTemporary } from './fixture'

const scenario: RealAgentScenario = {
  prepareProfile: prepareOmittedTemporaryProfile,
  toolResult: scenarioWeather,
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const location = await rememberTemporary('Current location: I am staying in Lyon, France, for a week.')
      await omitFromTemporarySnapshot(location)
      const turn = await context.runTurn('What\'s the weather like where I am staying?')
      const weather = turn.toolCalls.filter((call) => call.toolkitId === 'weather' && call.functionName === 'getWeather')
      assert.ok(weather.length > 0, turn.output)
      assert.ok(weather.every((call) => String(call.parsedInput?.['location']).toLowerCase().includes('lyon')), turn.output)
      await assertOmittedTemporaryRecall(context.profilePath, turn, location)
      return { turn, locationId: location.id }
    })
  }
}

export default scenario
