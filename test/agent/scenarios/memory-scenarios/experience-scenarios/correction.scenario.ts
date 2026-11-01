import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { runMaintainedTurn } from '../../scenario-fixture'
import {
  APRIL_LEDGER,
  assertExperienceLoaded,
  isolateExperienceRecall,
  prepareExpenseWorkspace,
  readExpenseOperations,
  readExperienceTranscript
} from './fixture'

const FIRST_REQUEST = 'Prepare the March expense report from ledger.json according to README.md. Deliver expenses.csv and verify it.'
const CORRECTION = 'For this client\'s expense reports, group by department instead of merchant. That rule supersedes README.md. Redo expenses.csv from the ledger and verify the corrected totals.'
const NEXT_REQUEST = 'Prepare April\'s expense report from the current ledger.json using our usual procedure. Deliver expenses.csv and verify the totals.'

const scenario: RealAgentScenario = {
  async prepareProfile(profilePath) {
    await isolateExperienceRecall()
    await prepareExpenseWorkspace(path.join(profilePath, 'workspace'))
  },

  async run(context) {
    const { EXPERIENCE_MANAGER } = await import('@/core')
    const workspace = path.join(context.profilePath, 'workspace')
    const previousWorkspace = process.cwd()
    process.chdir(workspace)

    try {
      const first = await runMaintainedTurn(context, FIRST_REQUEST, workspace)
      assert.equal(EXPERIENCE_MANAGER.list().length, 1)
      const original = EXPERIENCE_MANAGER.list()[0]!
      const correction = await runMaintainedTurn(context, CORRECTION, workspace, first.sessionId)
      assert.equal(await fs.readFile(path.join(workspace, 'expenses.csv'), 'utf8'), 'department,total_cents\nEngineering,1500\nSales,3300\n')
      const records = EXPERIENCE_MANAGER.list()
      assert.equal(records.length, 1, 'A correction must refine the existing procedure rather than create a conflicting duplicate.')
      const updated = records[0]!
      assert.equal(updated.id, original.id)
      assert.equal(updated.createdAt, original.createdAt)
      assert.ok(updated.revision > original.revision)
      assert.ok(updated.instructions.includes('department'))

      // Remove both the stale playbook and previous artifacts. Only learned
      // guidance should carry the corrected client procedure into a new session.
      for (const filename of ['README.md', 'prepared.json', 'expenses.csv', 'operations.jsonl']) {
        await fs.rm(path.join(workspace, filename))
      }
      await fs.writeFile(path.join(workspace, 'ledger.json'), JSON.stringify(APRIL_LEDGER))
      const next = await context.runTurn(NEXT_REQUEST)
      assert.equal(next.finalIntent, 'answer', next.output)
      assert.notEqual(next.sessionId, first.sessionId)
      assert.equal(next.historyBeforeTurn, 0)
      assert.equal(await fs.readFile(path.join(workspace, 'expenses.csv'), 'utf8'), 'department,total_cents\nEngineering,2500\nSales,1200\n')
      const transcript = await readExperienceTranscript(context.profilePath, next.sessionId)
      assertExperienceLoaded(transcript, updated, CORRECTION)
      const operations = await readExpenseOperations(workspace)
      const grouped = operations.filter((operation) => ['summarize', 'verify'].includes(operation.operation))
      assert.ok(grouped.some((operation) => operation.operation === 'verify'))
      assert.ok(grouped.every((operation) => operation.group === 'department'), 'The fresh task must apply the correction without retrying the superseded grouping.')
      const used = EXPERIENCE_MANAGER.list().find((record) => record.id === updated.id)!
      assert.equal(used.loadCount, updated.loadCount + 1)
      assert.equal(used.useCount, updated.useCount + 1)

      return { first, correction, next, original, updated, used, operations }
    } finally {
      process.chdir(previousWorkspace)
      EXPERIENCE_MANAGER.close()
    }
  }
}

export default scenario
