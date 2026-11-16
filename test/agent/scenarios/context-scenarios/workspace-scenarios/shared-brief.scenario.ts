import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const { CONVERSATION_REPOSITORY } = await import('@/core/session-manager/conversation-repository')
      const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
      const workspace = CONVERSATION_REPOSITORY.workspaces.create({
        name: 'Winter films', brief: 'Channel: Hearthlight. Visual style: warm amber, soft window light. Project reference: WILLOW-742.', resources: []
      })
      const firstId = CONVERSATION_SESSION_MANAGER.createSession(undefined, workspace.id).id
      const secondId = CONVERSATION_SESSION_MANAGER.createSession(undefined, workspace.id).id
      const prompt = 'From my workspace brief, state the channel name, visual style and project reference. Use only that brief; do not search or save anything.'
      const first = await context.runTurn(prompt, firstId)
      assert.equal(first.finalIntent, 'answer', first.output)
      assert.ok(first.output.includes('Hearthlight') && first.output.includes('WILLOW-742'), first.output)
      CONVERSATION_REPOSITORY.workspaces.update(workspace.id, {
        name: workspace.name, brief: 'Channel: Hearthlight. Visual style: warm amber, soft window light. Project reference: MAPLE-831.', resources: []
      })
      const second = await context.runTurn(prompt, secondId)
      assert.equal(second.finalIntent, 'answer', second.output)
      assert.ok(second.output.includes('Hearthlight') && second.output.includes('MAPLE-831'), second.output)
      assert.ok(!second.output.includes('WILLOW-742'), second.output)
      const refreshed = await context.runTurn('What is the project reference in my current workspace brief? Give just the reference.', firstId)
      assert.ok(refreshed.output.includes('MAPLE-831') && !refreshed.output.includes('WILLOW-742'), refreshed.output)
      CONVERSATION_REPOSITORY.workspaces.remove(workspace.id)

      return { first, second, refreshed }
    })
  }
}

export default scenario
