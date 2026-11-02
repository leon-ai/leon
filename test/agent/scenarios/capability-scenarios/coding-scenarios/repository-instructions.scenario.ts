import assert from 'node:assert/strict'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { createCodingFixture, type CodingFixture } from '../../../e2e/coding-fixture'
import { getProviderScenario } from '../../../e2e/provider-scenarios'
import { inScenarioWorkspace } from '../../scenario-fixture'

let fixture: CodingFixture

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    fixture = await createCodingFixture(path.join(profilePath, 'workspace'), 'coding_multiple_files')
  },
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const request = getProviderScenario('coding_multiple_files')!.buildInput(fixture.root)
      const turn = await context.runTurn(request)
      assert.equal(turn.finalIntent, 'answer', turn.output)
      const evidence = await fixture.verify()
      assert.ok(evidence.baselineFailed)
      assert.ok(evidence.testsPassed)
      assert.ok(evidence.protectedFilesPreserved)
      assert.ok(evidence.stagedDiffPreserved)
      assert.ok(evidence.headPreserved)
      assert.deepEqual(evidence.changedFiles, [...fixture.allowedChanges].sort())

      return { turn, evidence }
    })
  }
}

export default scenario
