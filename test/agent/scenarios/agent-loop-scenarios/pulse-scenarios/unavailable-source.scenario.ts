import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const OWNER_GOAL = 'I need to submit the budget today. Can you confirm its total from the formulas in the private workbook on my laptop? The workbook is the only source. I have not shared it and there is no copy online.'

const scenario: RealAgentScenario = {
  async run() {
    const { CONFIG_MANAGER } = await import('@/config')
    const { PulseTickOutcome } = await import('@/core/insights/insights-contract')
    const { default: PulseManager } = await import('@/core/pulse-manager/pulse-manager')
    const { getPulseResultRepository } = await import('@/core/pulse-manager/pulse-result-repository')
    const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
    const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
    await CONFIG_MANAGER.setValue(['runtime', 'pulse_enabled'], true)

    const session = CONVERSATION_SESSION_MANAGER.createSession()
    CONVERSATION_SESSION_MANAGER.updateSession(session.id, { title: 'Verify the budget total before submission' })
    CONVERSATION_REPOSITORY.upsertMessage(session.id, {
      who: 'owner', message: OWNER_GOAL, isAddedToHistory: true
    }, { sentAt: Date.now() - 10 * 60 * 1_000 })
    CONVERSATION_SESSION_MANAGER.updateSessionFromStoredMessages(session.id)

    await new PulseManager().tick('manual')

    const [tick] = getPulseResultRepository().readTickHistory(0, true).ticks
    assert.equal(tick?.outcome, PulseTickOutcome.Idle)
    assert.equal(tick.investigated, false)

    return { tick }
  }
}

export default scenario
