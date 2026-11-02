import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'
import { assertMemoryRecall, seedMemoryConversations } from '../fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const detail = 'The Caldera release review records operational readiness, deployment ownership, rollback responsibility and evidence from the staging checks. Each workstream keeps its signoff alongside the verification notes. '
      await seedMemoryConversations([
        'Caldera handoff: Mira owns the release. The go-live date is 11 December 2026.',
        'Caldera release blocker: the production signing certificate is awaiting approval.',
        `Caldera acceptance memo: exactly three gates must pass before go-live.\nGate 1: offline export works without network access.\n${detail.repeat(12)}\nGate 2: restoring a backup preserves all attachments.\n${detail.repeat(12)}\nGate 3: the audit log records the approving operator.`,
        'Borealis handoff: Tomas owns the January release. This is a different project.'
      ])
      const turn = await context.runTurn('Prepare a complete, concise Caldera handoff from our earlier conversations: release owner, go-live date, current blocker, and every acceptance gate. Keep other projects out.')
      assertMemoryRecall(turn)
      const answer = turn.output.toLowerCase()
      for (const value of ['mira', '11', '2026', 'certificate', 'offline', 'attachment', 'audit']) {
        assert.ok(answer.includes(value), turn.output)
      }
      assert.ok(!answer.includes('tomas') && !answer.includes('borealis'), turn.output)
      const expandedEvidence = turn.toolCalls.some((call) =>
        (call.toolId === 'memory' && Array.isArray(
          (call.parsedInput?.['options'] as Record<string, unknown> | undefined)?.['itemIds']
        )) || (call.toolId === 'sessions' && call.functionName === 'readMessage')
      )
      assert.ok(expandedEvidence, 'Incomplete handoff evidence must be expanded from its stored source.')
      return { turn }
    })
  }
}

export default scenario
