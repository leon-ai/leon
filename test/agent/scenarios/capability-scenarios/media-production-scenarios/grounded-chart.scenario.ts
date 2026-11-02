import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async () => {
      const turn = await context.runTurn('Use the ECharts tool to render a simple bar chart titled Caldera Inspection with regions Oslo=12 and Bergen=30 sites. Label the units. Deliver both SVG and PNG artifacts. These are the complete data; no web search or generation provider is needed.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.executionHistory.some((entry) => entry.function === 'document.echarts.render'))
      const { readArtifact } = await import('@/core/artifacts/artifact-store')
      for (const extension of ['svg', 'png']) {
        const artifact = turn.artifacts.find((entry) => entry.filename.endsWith(`.${extension}`))
        assert.ok(artifact, `The ${extension} output must be downloadable.`)
        const saved = await readArtifact(turn.sessionId, artifact.id)
        const bytes = await fs.readFile(saved.path)
        if (extension === 'svg') {
          const svg = bytes.toString()
          assert.ok(svg.includes('<svg') && svg.includes('Oslo') && svg.includes('Bergen'))
        } else {
          assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
        }
      }

      return { turn }
    })
  }
}

export default scenario
