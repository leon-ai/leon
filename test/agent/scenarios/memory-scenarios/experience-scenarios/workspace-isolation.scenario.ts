import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { runMaintainedTurn } from '../../scenario-fixture'
import {
  isolateExperienceRecall,
  prepareExpenseWorkspace,
  readExpenseOperations,
  readExperienceTranscript
} from './fixture'

const REQUEST = 'Prepare this client\'s expense report from ledger.json following the local README.md playbook. Deliver expenses.csv and verify it.'

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    await isolateExperienceRecall()
    await prepareExpenseWorkspace(path.join(profilePath, 'northwind'), 'merchant', 'Northwind')
    await prepareExpenseWorkspace(path.join(profilePath, 'contoso'), 'department', 'Contoso')
  },

  async run(context) {
    const { EXPERIENCE_MANAGER } = await import('@/core')
    const previousWorkspace = process.cwd()
    const northwind = path.join(context.profilePath, 'northwind')
    const contoso = path.join(context.profilePath, 'contoso')
    process.chdir(northwind)

    try {
      const first = await runMaintainedTurn(context, REQUEST, northwind)
      assert.equal(await fs.readFile(path.join(northwind, 'expenses.csv'), 'utf8'), 'merchant,total_cents\nCafe,800\nRail,4000\n')
      assert.equal(EXPERIENCE_MANAGER.list().length, 1)
      const experience = EXPERIENCE_MANAGER.list()[0]!
      assert.equal(experience.workspace, await fs.realpath(northwind), 'A client-local reporting procedure must retain its workspace scope.')

      process.chdir(contoso)
      assert.ok(!EXPERIENCE_MANAGER.getContext(contoso, REQUEST).some((card) => card.id === experience.id))
      assert.ok(!EXPERIENCE_MANAGER.search('expense report merchant', contoso).some((card) => card.id === experience.id))
      const second = await context.runTurn(REQUEST)
      assert.equal(second.finalIntent, 'answer', second.output)
      assert.notEqual(second.sessionId, first.sessionId)
      assert.equal(second.historyBeforeTurn, 0)
      assert.equal(await fs.readFile(path.join(contoso, 'expenses.csv'), 'utf8'), 'department,total_cents\nEngineering,1500\nSales,3300\n')
      const transcript = await readExperienceTranscript(context.profilePath, second.sessionId)
      assert.ok(!transcript.some((message) => message.content.includes(experience.id)), 'Another workspace must not receive or load this client\'s experience.')
      const retained = EXPERIENCE_MANAGER.list().find((record) => record.id === experience.id)!
      assert.equal(retained.loadCount, experience.loadCount)
      assert.equal(retained.useCount, experience.useCount)
      const operations = await readExpenseOperations(contoso)
      const grouped = operations.filter((operation) => ['summarize', 'verify'].includes(operation.operation))
      assert.ok(grouped.some((operation) => operation.operation === 'verify'))
      assert.ok(grouped.every((operation) => operation.group === 'department'))
      assert.equal(await fs.readFile(path.join(northwind, 'expenses.csv'), 'utf8'), 'merchant,total_cents\nCafe,800\nRail,4000\n')

      return { first, second, experience: retained, operations }
    } finally {
      process.chdir(previousWorkspace)
      EXPERIENCE_MANAGER.close()
    }
  }
}

export default scenario
