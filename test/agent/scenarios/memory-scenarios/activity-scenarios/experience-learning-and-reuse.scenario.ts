import assert from 'node:assert/strict'

import type { RealAgentScenario, RealScenarioTurn } from '../../../e2e/run-agent-provider-scenario'
import recovery from '../experience-scenarios/recovery.scenario'
import { MemoryActivityAction } from '@/core/llm-manager/memory-activity-contract'

const scenario: RealAgentScenario = {
  prepareProfile: recovery.prepareProfile!,
  async run(context) {
    const evidence = await recovery.run(context)
    const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
    const learned = CONVERSATION_REPOSITORY.listSessions({ limit: 100 }).items.flatMap((session) =>
      CONVERSATION_REPOSITORY.readAllMessages(session.id).flatMap((message) =>
        message.agentResponseTrace?.progressMessages ?? []))
      .filter((message) => message.memory?.action === MemoryActivityAction.ExperienceLearned)
    assert.equal(learned.length, 1)
    assert.equal(learned[0]!.iconName, 'brain-2-line')
    assert.ok(learned[0]!.skill?.instructions)
    const second = evidence['second'] as RealScenarioTurn
    const activities = second.progressMessages.filter((message) => message.id.startsWith('experience-activity:'))
    assert.ok(activities.some((message) => message.content.startsWith('Used experience:')))
    assert.ok(activities.every((message) => message.iconName === 'brain-2-line'))
    return { ...evidence, learned, activities }
  }
}

export default scenario
