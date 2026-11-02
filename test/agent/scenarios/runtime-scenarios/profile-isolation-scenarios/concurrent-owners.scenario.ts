import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run(context) {
    const { getProfilePaths } = await import('@/core/profile-runtime/profile-paths')
    const { runWithProfileContext } = await import('@/core/profile-runtime/profile-context')
    const { ensureActiveProfileRuntime } = await import('@/core/profile-runtime/initialize-profile-runtime')
    const { createEmptyOwnerProfile, writeOwnerProfile } = await import('@/core/context-manager/owner-profile')
    const primary = getProfilePaths()
    const secondary = getProfilePaths(`${primary.name}-other`)
    await fs.mkdir(secondary.root, { recursive: true })
    await fs.copyFile(primary.config, secondary.config)
    await fs.copyFile(primary.dotEnv, secondary.dotEnv)
    await fs.cp(primary.connections, secondary.connections, { recursive: true })
    const owners = [
      { paths: primary, name: 'Mira', city: 'Oslo', excluded: 'Bergen' },
      { paths: secondary, name: 'Nora', city: 'Bergen', excluded: 'Oslo' }
    ]
    for (const owner of owners) {
      await runWithProfileContext({ profileName: owner.paths.name }, async () => {
        const profile = createEmptyOwnerProfile()
        profile.owner_first_name = owner.name
        profile.owner_current_city = owner.city
        profile.identity = [`First name: ${owner.name}.`]
        profile.homeAndImportantPlaces = [`Home city: ${owner.city}.`]
        await writeOwnerProfile(profile)
        await ensureActiveProfileRuntime()
      })
    }
    const turns = await Promise.all(owners.map((owner) => runWithProfileContext(
      { profileName: owner.paths.name }, async () => {
        const turn = await context.runTurn('From my owner profile, tell me my first name and home city. No outside lookup is needed.')
        assert.equal(turn.finalIntent, 'answer', turn.output)
        assert.ok(turn.output.includes(owner.name) && turn.output.includes(owner.city), turn.output)
        assert.ok(!turn.output.includes(owner.excluded), turn.output)

        return turn
      }
    )))
    assert.notEqual(turns[0]!.sessionId, turns[1]!.sessionId)

    return { turns }
  }
}

export default scenario
