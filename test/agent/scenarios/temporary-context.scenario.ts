import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import SQLite from 'better-sqlite3'
import type { RealAgentScenario } from '../e2e/run-agent-provider-scenario'
import type { AgentToolTranscriptMessage } from '@/core/llm-manager/types'

const HOME_CITY = 'Shenzhen'
const TEMPORARY_CITY = 'Lyon'
const OWNER_STATEMENT = 'I\'m staying in Lyon, France, where I studied, for a while.'
const WEATHER_REQUEST = 'What\'s the weather like?'
const MAXIMUM_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    const contextPath = path.join(profilePath, 'context')
    await fs.writeFile(path.join(contextPath, '.owner-profile.json'), JSON.stringify({
      owner_current_city: HOME_CITY,
      owner_current_country: 'China',
      homeAndImportantPlaces: [`Lives in ${HOME_CITY}, China.`]
    }))
  },

  toolResult(input) {
    if (input.toolkitId !== 'weather' || input.toolId !== 'openmeteo' || input.functionName !== 'getWeather') {
      return undefined
    }

    // Echo the requested location; a fixture must not reveal the expected city
    // and accidentally rescue an incorrect first weather call.
    return {
      status: 'success',
      message: 'Weather retrieved.',
      data: {
        tool_id: input.toolId,
        toolkit_id: input.toolkitId,
        function_name: input.functionName,
        input: input.toolInput || null,
        parsed_input: input.parsedInput || null,
        output: { result: { success: true, data: {
          location: input.parsedInput?.['location'],
          current: { temperature_2m: 18, weather: 'clear', wind_speed_10m: 7 },
          units: { temperature_2m: '°C', wind_speed_10m: 'km/h' }
        } } }
      }
    }
  },

  async run({ profilePath, runTurn }) {
    const first = await runTurn(OWNER_STATEMENT)
    assert.equal(first.finalIntent, 'answer', JSON.stringify(first))
    assert.equal(first.historyBeforeTurn, 0)

    // Inspect immediately: background extraction must not hide a failure to
    // capture a circumstance before finishing the foreground turn.
    const db = new SQLite(path.join(profilePath, 'memory', 'index.sqlite'), {
      readonly: true, fileMustExist: true
    })
    try {
      const records = db.prepare('SELECT * FROM active_memory_items WHERE scope = \'temporary\'').all()
      const location = records.find((record) => String(record['content_md']).toLowerCase().includes(TEMPORARY_CITY.toLowerCase()))
      assert.ok(location, `No temporary location captured: ${JSON.stringify(first)}`)
      assert.ok(Number(location['expires_at']) > Date.now())
      assert.ok(Number(location['expires_at']) - Number(location['created_at']) <= MAXIMUM_LIFETIME_MS)
      assert.ok(String(location['source_ref']).includes(first.sessionId))
      const metadata = JSON.parse(String(location['metadata_json'])) as { evidence?: string }
      assert.ok(metadata.evidence && OWNER_STATEMENT.includes(metadata.evidence))

      const second = await runTurn(WEATHER_REQUEST)
      assert.notEqual(second.sessionId, first.sessionId)
      assert.equal(second.historyBeforeTurn, 0, 'A fresh session must not inherit conversation history.')
      assert.equal(second.finalIntent, 'answer', JSON.stringify(second))

      const state = JSON.parse(await fs.readFile(path.join(
        profilePath, 'sessions', second.sessionId, '.agent-conversation-state.json'
      ), 'utf8')) as { transcript: AgentToolTranscriptMessage[] }
      const snapshots = state.transcript.flatMap((message) => {
        const snapshot = message.role === 'user' ? message.runtimeContext?.['temporary_context'] : undefined
        return Array.isArray(snapshot) ? snapshot : []
      }) as Array<{ id: string }>
      assert.ok(snapshots.some((entry) => entry.id === location['id']), 'The agent must receive the saved temporary record.')
      assert.ok(!state.transcript.some((message) => message.content.startsWith('<user_request>') && message.content.includes(OWNER_STATEMENT)))
      const calls = second.toolCalls.filter((call) => call.toolkitId === 'weather' && call.functionName === 'getWeather')
      assert.ok(calls.length > 0, `No weather call: ${JSON.stringify(second)}`)
      for (const call of calls) {
        const requestedLocation = String(call.parsedInput?.['location']).toLowerCase()
        assert.ok(requestedLocation.includes(TEMPORARY_CITY.toLowerCase()), JSON.stringify({ call, injected: snapshots }))
        assert.ok(!requestedLocation.includes(HOME_CITY.toLowerCase()), JSON.stringify({ call, injected: snapshots }))
      }

      const owner = JSON.parse(await fs.readFile(path.join(profilePath, 'context', '.owner-profile.json'), 'utf8'))
      assert.equal(owner.owner_current_city, HOME_CITY, 'A stay must not overwrite the durable home city.')

      return { first, second, temporaryLocation: location, homeCity: HOME_CITY }
    } finally {
      db.close()
    }
  }
}

export default scenario
