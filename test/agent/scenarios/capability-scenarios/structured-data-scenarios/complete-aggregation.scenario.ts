import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { inScenarioWorkspace } from '../../scenario-fixture'

const scenario: RealAgentScenario = {
  async run(context) {
    return inScenarioWorkspace(context.profilePath, async (workspace) => {
      const rows = Array.from({ length: 1_200 }, (_, index) => `${index + 1},${index % 2 ? 'B' : 'A'},${index % 2 ? 7 : 3}`)
      await fs.writeFile(path.join(workspace, 'orders.csv'), `id,region,amount\n${rows.join('\n')}\n`)
      const turn = await context.runTurn('Use the DuckDB tool to aggregate all orders.csv rows by region. Report the row count and amount total for each region, with a grand total. Do not infer totals from samples or output every input row.')
      assert.equal(turn.finalIntent, 'answer', turn.output)
      assert.ok(turn.executionHistory.some((entry) => entry.function === 'structured_knowledge.duckdb.query'))
      const text = turn.output.replaceAll(',', '').replaceAll(' ', '')
      for (const number of ['600', '1800', '4200', '6000']) {
        assert.ok(text.includes(number), turn.output)
      }

      return { turn, sourceRows: rows.length }
    })
  }
}

export default scenario
