import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, scenarioWeather } from '../../scenario-fixture'

let searches = 0
const scenario: RealAgentScenario = {
  toolResult(input) {
    if (input.toolkitId !== 'search_web') {
      return scenarioWeather(input)
    }
    searches += 1

    return {
      status: 'success', message: 'Search completed.',
      data: {
        tool_id: input.toolId, toolkit_id: input.toolkitId, function_name: input.functionName,
        input: input.toolInput || null, parsed_input: input.parsedInput || null,
        output: { result: { success: true, data: { results: [{
          title: 'Caldera pilot update', url: 'https://example.invalid/caldera-pilot',
          snippet: 'The Caldera pilot inspected 42 sites. Its next milestone is the September review.'
        }] } } }
      }
    }
  },
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const first = await context.runTurn('Run exactly one web search for the Caldera pilot update. Keep its results available for my next question, but do not write them to files or memory. Just tell me when the search is ready.')
      assert.equal(first.finalIntent, 'answer', first.output)
      assert.equal(searches, 1)
      const second = await context.runTurn('Without another search or lookup, tell me the number of sites inspected and the next milestone from that search result.', first.sessionId)
      assert.equal(second.finalIntent, 'answer', second.output)
      assert.equal(searches, 1, 'The follow-up must reuse the original search result.')
      assert.ok(second.output.includes('42') && second.output.includes('September'))
      assert.ok(!second.executionHistory.some((execution) => execution.function.startsWith('search_web.')))

      return { first, second, searches }
    })
  }
}

export default scenario
