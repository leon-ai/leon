import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace, runMaintainedTurn } from '../../scenario-fixture'
import { persistentScenarioRecords } from '../fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const { createEmptyOwnerProfile, writeOwnerProfile, readOwnerProfileSync } = await import('@/core/context-manager/owner-profile')
      const owner = createEmptyOwnerProfile()
      owner.owner_first_name = 'Mira'
      owner.identity = ['First name: Mira.']
      await writeOwnerProfile(owner)
      const turn = await runMaintainedTurn(context,
        'Ciao Leon! Sto parlando di te, il mio assistente: il tuo italiano non è sempre idiomatico e tu non sei madrelingua italiano. Non sto descrivendo le mie capacità. Rispondi con una sola frase soltanto per questo messaggio.', workspace)
      const profile = readOwnerProfileSync()
      assert.equal(profile.owner_first_name, 'Mira')
      assert.deepEqual(profile.identity, owner.identity)
      assert.deepEqual(profile.background, [])
      const records = await persistentScenarioRecords()
      assert.equal(records.length, 0, `Assistant limitations and one-turn formatting must not become durable owner facts: ${JSON.stringify(records)}`)

      return { turn, profile, records }
    })
  }
}

export default scenario
