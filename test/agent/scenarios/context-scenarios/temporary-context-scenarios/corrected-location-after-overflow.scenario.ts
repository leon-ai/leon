import assert from 'node:assert/strict'
import path from 'node:path'

import SQLite from 'better-sqlite3'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, scenarioWeather } from '../../scenario-fixture'
import { assertOmittedTemporaryRecall, omitFromTemporarySnapshot, prepareOmittedTemporaryProfile, rememberTemporary } from './fixture'

const scenario: RealAgentScenario = {
  prepareProfile: prepareOmittedTemporaryProfile,
  toolResult: scenarioWeather,
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const former = await rememberTemporary('Current location: I am staying in Lyon, France, for a week.')
      const current = await rememberTemporary('Current location: I am now staying in Madrid, Spain, for a week.', former.id)
      const expired = await rememberTemporary('Current location: I am staying in Lisbon, Portugal.')
      const forgotten = await rememberTemporary('Current location: I am staying in Berlin, Germany.')
      const db = new SQLite(path.join(context.profilePath, 'memory', 'index.sqlite'))
      try {
        db.prepare('UPDATE memory_items SET expires_at = ? WHERE id = ?').run(Date.now() - 1_000, expired.id)
      } finally {
        db.close()
      }
      const { MEMORY_MANAGER } = await import('@/core')
      await MEMORY_MANAGER.forgetById(forgotten.id)
      await omitFromTemporarySnapshot(current)
      const turn = await context.runTurn('What\'s the weather like where I am staying?')
      const weather = turn.toolCalls.filter((call) => call.toolkitId === 'weather' && call.functionName === 'getWeather')
      assert.ok(weather.length > 0, turn.output)
      assert.ok(weather.every((call) => String(call.parsedInput?.['location']).toLowerCase().includes('madrid')), turn.output)
      await assertOmittedTemporaryRecall(context.profilePath, turn, current, [former.id, expired.id, forgotten.id])
      return { turn, currentLocationId: current.id }
    })
  }
}

export default scenario
