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

const FIRST_REQUEST = 'Prepare the March expense report from ledger.json using this workspace\'s README.md playbook. Deliver expenses.csv and verify it.'
const NEXT_REQUEST = 'Please reconcile April receipts into the reimbursement summary and check the totals. The current entries are in ledger.json; deliver expenses.csv.'

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
      assert.equal(await fs.readFile(path.join(workspace, 'expenses.csv'), 'utf8'), 'merchant,total_cents\nCafe,800\nRail,4000\n')
      const learned = EXPERIENCE_MANAGER.list()
      assert.equal(learned.length, 1, 'A verified client reporting workflow must be learned automatically.')
      const experience = learned[0]!

      // The next session must use experience rather than rereading the playbook
      // or copying an old report whose figures no longer match the ledger.
      await fs.rm(path.join(workspace, 'README.md'))
      await fs.rm(path.join(workspace, 'prepared.json'))
      await fs.rm(path.join(workspace, 'expenses.csv'))
      await fs.rm(path.join(workspace, 'operations.jsonl'))
      await fs.writeFile(path.join(workspace, 'ledger.json'), JSON.stringify(APRIL_LEDGER))

      const second = await context.runTurn(NEXT_REQUEST)
      assert.equal(second.finalIntent, 'answer', second.output)
      assert.notEqual(second.sessionId, first.sessionId)
      assert.equal(second.historyBeforeTurn, 0)
      assert.equal(await fs.readFile(path.join(workspace, 'expenses.csv'), 'utf8'), 'merchant,total_cents\nCafe,700\nRail,3000\n')
      const transcript = await readExperienceTranscript(context.profilePath, second.sessionId)
      assertExperienceLoaded(transcript, experience, FIRST_REQUEST)
      const used = EXPERIENCE_MANAGER.list().find((record) => record.id === experience.id)!
      assert.equal(used.loadCount, 1)
      assert.equal(used.useCount, 1)
      const operations = await readExpenseOperations(workspace)
      assert.ok(operations.some((operation) => operation.operation === 'verify' && operation.group === 'merchant'))

      return { first, second, experience: used, operations }
    } finally {
      process.chdir(previousWorkspace)
      EXPERIENCE_MANAGER.close()
    }
  }
}

export default scenario
