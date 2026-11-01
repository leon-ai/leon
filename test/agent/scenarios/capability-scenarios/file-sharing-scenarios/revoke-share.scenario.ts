import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      await fs.writeFile(path.join(workspace, 'handoff.txt'), 'Share only this handoff: SPRUCE-42')
      await fs.writeFile(path.join(workspace, 'private.txt'), 'Do not share this neighbour.')
      const first = await context.runTurn('Use miniserve to share only handoff.txt read-only on the LAN for 120 seconds. Return its full loopback download URL so I can check it. Do not share the workspace directory or private.txt.')
      assert.equal(first.finalIntent, 'answer', first.output)
      const url = first.output.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s)\]<>]+\/handoff\.txt/)?.[0]
      assert.ok(url, first.output)
      const response = await fetch(url)
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'Share only this handoff: SPRUCE-42')
      const neighbour = await fetch(new URL('private.txt', url))
      assert.equal(neighbour.status, 404)
      const write = await fetch(url, { method: 'POST', body: 'unauthorized edit' })
      assert.ok(!write.ok)
      const second = await context.runTurn('Revoke that LAN share now. Verify it is stopped using the sharing tool. Do not delete or edit my original files.', first.sessionId)
      assert.equal(second.finalIntent, 'answer', second.output)
      assert.ok(second.executionHistory.some((entry) => entry.function === 'file_system.miniserve.stop'))
      const reachable = await fetch(url).then((result) => result.ok, () => false)
      assert.equal(reachable, false)
      assert.equal(await fs.readFile(path.join(workspace, 'private.txt'), 'utf8'), 'Do not share this neighbour.')

      return { first, second }
    })
  }
}

export default scenario
