import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const PRINCIPLE = 'For handoffs, put the next action before background details.'
const scenario: RealAgentScenario = {
  async run(context) {
    const { CONFIG_MANAGER } = await import('@/config')
    await CONFIG_MANAGER.setValue(['runtime', 'private_diary_enabled'], true)
    const { SELF_MODEL_MANAGER } = await import('@/core')
    await SELF_MODEL_MANAGER.reinforceBehavioralPrinciple(PRINCIPLE, 0.9)
    const snapshot = SELF_MODEL_MANAGER.getSnapshot()
    assert.ok(snapshot.includes(PRINCIPLE))
    const diary = await fs.readFile(SELF_MODEL_MANAGER.getDiaryPath(), 'utf8')
    assert.ok(diary.includes(PRINCIPLE))
    const turn = await context.runTurn('Write a two-sentence project handoff. The release is ready; Nora should publish the release notes today. Include the next action and the background.')
    assert.equal(turn.finalIntent, 'answer', turn.output)
    const firstSentence = turn.output.split('.')[0]!.toLowerCase()
    assert.ok(firstSentence.includes('nora') && firstSentence.includes('release notes'), turn.output)

    return { turn, snapshot }
  }
}

export default scenario
