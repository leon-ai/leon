import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { createEmptyOwnerProfile, writeOwnerProfile, readOwnerProfileSync } = await import('@/core/context-manager/owner-profile')
      await writeOwnerProfile(createEmptyOwnerProfile())
      const turn = await runMaintainedTurn(context,
        'Let me introduce myself: my own first name is Leon, and I work as a civil engineer. Yes, we share a first name. Acknowledge briefly.', workspace)
      const profile = readOwnerProfileSync()
      assert.equal(profile.owner_first_name, 'Leon')
      assert.ok(profile.workAndCareer.join(' ').toLowerCase().includes('engineer'))

      return { turn, profile }
    })
  }
}

export default scenario
