import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const content = 'Verified handoff: SPRUCE-42\n'
      const source = path.join(workspace, 'handoff.txt')
      await fs.writeFile(source, content)
      const turn = await context.runTurn('Attach handoff.txt from this workspace as a downloadable conversation file. Use the file attachment tool; do not rewrite its contents.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.equal(turn.artifacts.length, 1)
      const artifact = turn.artifacts[0]!
      assert.equal(artifact.session_id, turn.sessionId)
      assert.equal(artifact.filename, 'handoff.txt')
      assert.ok(artifact.url.startsWith('/api/'))
      await fs.writeFile(source, 'Changed working copy.')
      const { readArtifact } = await import('@/core/artifacts/artifact-store')
      const saved = await readArtifact(turn.sessionId, artifact.id)
      assert.equal(await fs.readFile(saved.path, 'utf8'), content)
      await assert.rejects(readArtifact('other-conversation', artifact.id))

      return { turn, artifact }
    })
  }
}

export default scenario
