import assert from 'node:assert/strict'
import path from 'node:path'

import SQLite from 'better-sqlite3'
import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import migrate from '@@/scripts/setup/migrations/2026110704012858-queue-temporary-location-backfill'
import travelLocation from './travel-location.scenario'

const OWNER_EVIDENCE = 'I am staying in Lyon, France, for a week.'

const scenario: RealAgentScenario = {
  prepareProfile: travelLocation.prepareProfile!,
  toolResult: travelLocation.toolResult!,
  async run({ profilePath, runTurn }) {
    const { MEMORY_MANAGER, POST_TURN_MAINTENANCE_QUEUE, AMBIENT_CONDITIONS_MANAGER } = await import('@/core')
    const record = await MEMORY_MANAGER.remember({
      scope: 'temporary', kind: 'note', content: OWNER_EVIDENCE,
      sourceType: 'explicit_user', sourceRef: 'scenario:original-owner-evidence',
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1_000,
      metadata: { evidence: OWNER_EVIDENCE }
    })
    // Newer unrelated facts fill a batch; the older stay must still be reached
    // and tracked by maintenance draining, not lost behind the first batch.
    for (let index = 0; index < 6; index++) {
      const evidence = `I have a review for project ${index + 1} this week.`
      await MEMORY_MANAGER.remember({
        scope: 'temporary', kind: 'note', content: evidence,
        sourceType: 'explicit_user', sourceRef: `scenario:project:${index}`,
        metadata: { evidence }
      })
    }
    const db = new SQLite(path.join(profilePath, 'memory', 'index.sqlite'))
    try {
      // Represent a legacy record: only its original supporting quote, without
      // the location projection or newer write-time metadata.
      db.prepare('UPDATE memory_items SET metadata_json = ? WHERE id = ?')
        .run(JSON.stringify({ evidence: OWNER_EVIDENCE }), record.id)
      const before = db.prepare('SELECT * FROM memory_items WHERE id = ?').get(record.id)!
      await migrate(getProfilePaths())
      await MEMORY_MANAGER.requestTemporaryLocationBackfill()
      await POST_TURN_MAINTENANCE_QUEUE.whenIdle()
      const location = await MEMORY_MANAGER.getTemporaryLocation()
      assert.equal(location?.city.toLowerCase(), 'lyon')
      const after = db.prepare('SELECT * FROM memory_items WHERE id = ?').get(record.id)!
      assert.deepEqual({ ...after, metadata_json: before['metadata_json'] }, before)
      assert.equal(JSON.parse(String(after['metadata_json'])).evidence, OWNER_EVIDENCE)
      const ambient = await AMBIENT_CONDITIONS_MANAGER.getSnapshot()
      assert.ok(ambient.weather?.location.toLowerCase().includes('lyon'))
      const turn = await runTurn('What is the weather like where I am staying?')
      const calls = turn.toolCalls.filter((call) => call.toolkitId === 'weather' && call.functionName === 'getWeather')
      assert.ok(calls.length > 0, turn.output)
      assert.ok(calls.every((call) => String(call.parsedInput?.['location']).toLowerCase().includes('lyon')))
      return { turn, location, originalExpiresAt: record.expiresAt }
    } finally {
      db.close()
    }
  }
}

export default scenario
