import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { assertMemoryRecall, seedMemoryConversations } from '../fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      await seedMemoryConversations([
        'My favourite weekend meal is beef stew. I enjoy cooking it slowly.',
        'I like plain yogurt and would enjoy making it myself on weekends.',
        'My kitchen has a slow cooker with a yogurt mode. I do not own an oven.'
      ])
      const turn = await context.runTurn('Suggest two things I could make this weekend, tailored to my food preferences and the equipment in my kitchen. Explain briefly how I can make each.')
      assertMemoryRecall(turn)
      const answer = turn.output.toLowerCase()
      assert.ok(answer.includes('beef') && answer.includes('stew'), turn.output)
      assert.ok(answer.includes('yogurt') || answer.includes('yoghurt'), turn.output)
      assert.ok(answer.includes('slow cooker'), turn.output)
      // The owner has no oven; neither recipe may depend on one.
      assert.ok(!/preheat (?:the |your |an )?oven|bake (?:it |them )?in (?:the |your |an )?oven/i.test(turn.output), turn.output)
      return { turn }
    })
  }
}

export default scenario
