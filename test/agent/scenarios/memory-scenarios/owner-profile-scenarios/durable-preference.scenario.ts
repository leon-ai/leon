import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { readOwnerProfileSync, writeOwnerProfile, createEmptyOwnerProfile } = await import('@/core/context-manager/owner-profile')
      const initial = createEmptyOwnerProfile()
      initial.owner_first_name = 'Mira'
      initial.identity = ['First name: Mira.']
      await writeOwnerProfile(initial)
      const first = await runMaintainedTurn(context,
        'For my owner profile: I prefer distances in kilometres. This is a lasting preference. Acknowledge briefly.', workspace)
      const profile = readOwnerProfileSync()
      assert.equal(profile.owner_first_name, 'Mira')
      assert.ok(JSON.stringify(profile).toLowerCase().includes('kilomet'))
      const second = await context.runTurn('Which distance unit do I prefer? Answer briefly from my owner profile.')
      assert.equal(second.finalIntent, 'answer', second.output)
      assert.equal(second.historyBeforeTurn, 0)
      assert.ok(second.output.toLowerCase().includes('kilomet'))

      return { first, second, profile }
    })
  }
}

export default scenario
