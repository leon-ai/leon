import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const REGISTRY_FILE = 'public-registry-extract.json'
const ESTABLISHMENT_ID = 'REG-851709'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      await fs.writeFile(path.join(workspace, REGISTRY_FILE), JSON.stringify({
        establishmentId: ESTABLISHMENT_ID,
        status: 'active',
        entityType: 'sole proprietorship',
        legalName: null,
        legalNameVisibility: 'withheld from the public register',
        legalNameVerification: 'registration certificate available to the business owner'
      }))

      const turn = await context.runTurn(
        `What exact legal business name should I enter on this form? Its business search also accepts an establishment ID. Use only the official extract in ${REGISTRY_FILE}.`
      )

      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.executionHistory.some((entry) =>
        entry.function === 'file_system.file.read' && entry.status === 'success'
      ))
      assert.ok(turn.responseTrace.inferences?.some((attempt) =>
        attempt.phase === 'review' && attempt.outcome === 'completed'
      ))
      assert.match(
        turn.output,
        /withhold|withheld|redact|not (?:public|disclosed|shown)|does not (?:disclose|show)|unavailable/i
      )
      assert.match(turn.output, /registration certificate/i)
      assert.ok(turn.output.includes(ESTABLISHMENT_ID), turn.output)

      return { turn }
    })
  }
}

export default scenario
