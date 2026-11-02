import assert from 'node:assert/strict'

import type { RealAgentScenario, RealScenarioTurn } from '../../../e2e/run-agent-provider-scenario'
import omittedLocation from '../../context-scenarios/temporary-context-scenarios/omitted-travel-location.scenario'
import { MemoryActivityAction } from '@/core/llm-manager/memory-activity-contract'

const scenario: RealAgentScenario = {
  prepareProfile: omittedLocation.prepareProfile!,
  toolResult: omittedLocation.toolResult!,
  async run(context) {
    const evidence = await omittedLocation.run(context)
    const turn = evidence['turn'] as RealScenarioTurn
    const loaded = turn.responseTrace.progressMessages?.filter((message) =>
      message.memory?.action === MemoryActivityAction.TemporaryLoaded) ?? []
    assert.equal(loaded.length, 1, 'Repeated inferences retain one automatic loading activity.')
    assert.equal(loaded[0]!.iconName, 'brain-2-line')
    assert.ok(loaded[0]!.memory!.entries.length > 0)
    assert.ok(!loaded[0]!.memory!.entries.some((entry) => entry.id === evidence['locationId']))
    assert.ok(turn.executionHistory.some((call) => call.function === 'structured_knowledge.memory.read'))
    return { ...evidence, loaded }
  }
}

export default scenario
