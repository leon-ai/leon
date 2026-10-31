import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RealAgentScenario } from '../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run({ profilePath, runTurn }) {
    const { runWithTurnTiming, setTurnTimingSession } = await import('@/core/llm-manager/turn-timing')
    const turnId = randomUUID()
    const result = await runWithTurnTiming(turnId, null, async () => {
      const turn = await runTurn('Reply exactly TIMING_READY. Do not use tools.')
      setTurnTimingSession(turn.sessionId)
      return turn
    })
    assert.equal(result.finalIntent, 'answer')
    const directory = path.join(profilePath, 'logs', 'turns')
    const files = await fs.readdir(directory)
    const records = (await Promise.all(files.map((file) => fs.readFile(path.join(directory, file), 'utf8'))))
      .join('\n').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record['turnId'] === turnId)
    assert.ok(records.some((record) => record['kind'] === 'inference' && record['duty'] === 'react'))
    assert.ok(records.some((record) => record['kind'] === 'inference' && record['goal'] === 'answer-generation'))
    assert.ok(records.some((record) => record['kind'] === 'phase' && record['goal'] === 'turn'))
    assert.ok(records.every((record) => record['sessionId'] === result.sessionId && Number(record['durationMs']) >= 0))
    assert.ok(records.every((record) => !('prompt' in record) && !('reasoning' in record)))
    return { result, records }
  }
}

export default scenario
