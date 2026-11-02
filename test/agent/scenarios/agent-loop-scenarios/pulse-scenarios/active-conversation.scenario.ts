import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run(context) {
    const { CONFIG_MANAGER } = await import('@/config')
    const { PULSE_MANAGER } = await import('@/core')
    await CONFIG_MANAGER.setValue(['runtime', 'pulse_enabled'], true)
    const turn = await context.runTurn('I am working on a report now. Reply briefly; no tools are needed.')
    assert.equal(turn.finalIntent, 'answer', turn.output)
    await PULSE_MANAGER.tick('manual')
    const state = JSON.parse(await fs.readFile(path.join(
      context.profilePath, 'context', 'private', '.leon-pulse-state.json'
    ), 'utf8'))
    assert.equal(state.recentTicks[0].outcome, 'skipped')
    assert.ok(state.recentTicks[0].note.includes('active owner conversation'))
    assert.equal(state.matters.filter((matter: { status: string }) => matter.status === 'executing').length, 0)

    return { turn, tick: state.recentTicks[0] }
  }
}

export default scenario
