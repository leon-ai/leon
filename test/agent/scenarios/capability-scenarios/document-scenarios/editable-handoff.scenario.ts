import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const turn = await context.runTurn('Use document.document.create to produce an editable Word handoff titled Caldera Handoff. Include Nora as owner, 42 inspected sites, and Tuesday as the next review. Read the created document with the file document reader to verify those facts, then provide the downloadable DOCX. Do not claim visual verification.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.executionHistory.some((entry) => entry.function === 'document.document.create'))
      assert.ok(turn.executionHistory.some((entry) => entry.function === 'file_system.file.readDocument'))
      const artifact = turn.artifacts.find((entry) => entry.filename.endsWith('.docx'))
      assert.ok(artifact, 'Deliver an actual editable document artifact.')
      const { readArtifact } = await import('@/core/artifacts/artifact-store')
      const saved = await readArtifact(turn.sessionId, artifact.id)
      const bytes = await fs.readFile(saved.path)
      assert.equal(bytes.subarray(0, 2).toString(), 'PK')
      assert.ok(bytes.length > 1_000)

      return { turn, artifact }
    })
  }
}

export default scenario
