import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { assertOmittedTemporaryRecall, omitFromTemporarySnapshot, rememberTemporary } from './fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const connection = await rememberTemporary('Current internet connection: I am on a metered mobile hotspot for a week. Avoid large uploads and downloads until my unmetered connection returns.')
      await omitFromTemporarySnapshot(connection)
      const turn = await context.runTurn('Given my current internet connection, should I start a 25 GB cloud backup now, or wait? Advise briefly; do not start any transfer.')
      await assertOmittedTemporaryRecall(context.profilePath, turn, connection)
      const answer = turn.output.toLowerCase()
      assert.ok(answer.includes('wait') || answer.includes('defer'), turn.output)
      assert.ok(answer.includes('metered') || answer.includes('hotspot'), turn.output)
      return { turn, connectionId: connection.id }
    })
  }
}

export default scenario
