import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { AgentToolTranscriptMessage } from '@/core/llm-manager/types'

export const MARCH_LEDGER = [
  { receipt: 'march-1', merchant: 'Rail', department: 'Sales', cents: 2_500, status: 'posted' },
  { receipt: 'march-1', merchant: 'Rail', department: 'Sales', cents: 2_500, status: 'posted' },
  { receipt: 'march-2', merchant: 'Cafe', department: 'Sales', cents: 800, status: 'posted' },
  { receipt: 'march-3', merchant: 'Rail', department: 'Engineering', cents: 1_500, status: 'posted' },
  { receipt: 'march-4', merchant: 'Hotel', department: 'Sales', cents: 9_000, status: 'void' }
]
export const APRIL_LEDGER = [
  { receipt: 'april-1', merchant: 'Rail', department: 'Sales', cents: 1_200, status: 'posted' },
  { receipt: 'april-2', merchant: 'Cafe', department: 'Engineering', cents: 700, status: 'posted' },
  { receipt: 'april-2', merchant: 'Cafe', department: 'Engineering', cents: 700, status: 'posted' },
  { receipt: 'april-3', merchant: 'Rail', department: 'Engineering', cents: 1_800, status: 'posted' },
  { receipt: 'april-4', merchant: 'Hotel', department: 'Sales', cents: 6_000, status: 'pending' }
]

/**
 * Keep procedural recall independent of factual memory and raw session search.
 */
export async function isolateExperienceRecall(): Promise<void> {
  const { ProfileHelper } = await import('@/helpers/profile-helper')

  for (const toolId of ['memory', 'sessions']) {
    await ProfileHelper.disableTool(`structured_knowledge.${toolId}`)
    assert.ok(ProfileHelper.isToolDisabled(toolId, 'structured_knowledge'))
  }
}

const EXPENSE_CLI = `
import fs from 'node:fs'

const operation = process.argv[2]
const groupIndex = process.argv.indexOf('--group')
const group = groupIndex === -1 ? undefined : process.argv[groupIndex + 1]
fs.appendFileSync('operations.jsonl', JSON.stringify({ operation, group }) + '\\n')

function normalize() {
  const seen = new Set()
  return JSON.parse(fs.readFileSync('ledger.json', 'utf8')).filter((row) => {
    if (row.status !== 'posted' || seen.has(row.receipt)) {
      return false
    }
    seen.add(row.receipt)
    return true
  })
}

function summarize(rows) {
  if (!['merchant', 'department'].includes(group)) {
    throw new Error('Choose --group merchant or --group department according to the workspace playbook.')
  }
  const totals = new Map()
  for (const row of rows) {
    totals.set(row[group], (totals.get(row[group]) ?? 0) + row.cents)
  }
  return [group + ',total_cents', ...[...totals].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, cents]) => key + ',' + cents)].join('\\n') + '\\n'
}

try {
  if (operation === 'help') {
    console.log('Operations: normalize, summarize --group merchant|department, verify --group merchant|department. Normalize ledger.json into prepared.json, summarize into expenses.csv, then independently verify against the ledger. Select grouping from the workspace playbook or current owner instructions.')
  } else if (operation === 'normalize') {
    const rows = normalize()
    fs.writeFileSync('prepared.json', JSON.stringify(rows))
    console.log(JSON.stringify({ preparedRows: rows.length, policy: 'posted charges only; one row per receipt' }))
  } else if (operation === 'summarize') {
    const rows = JSON.parse(fs.readFileSync('prepared.json', 'utf8'))
    fs.writeFileSync('expenses.csv', summarize(rows))
    console.log(JSON.stringify({ report: 'expenses.csv', group, totalCents: rows.reduce((sum, row) => sum + row.cents, 0) }))
  } else if (operation === 'verify') {
    const actual = fs.readFileSync('expenses.csv', 'utf8')
    if (actual !== summarize(normalize())) {
      throw new Error('Report does not reconcile with the original ledger.')
    }
    console.log(JSON.stringify({ verified: true, group, report: actual }))
  } else {
    throw new Error('Inspect node expenses.mjs help for supported operations.')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
`

/**
 * Prepare a local expense application whose reports depend on actual input data.
 */
export async function prepareExpenseWorkspace(
  workspace: string,
  group: 'merchant' | 'department' = 'merchant',
  client = 'Northwind'
): Promise<void> {
  await fs.mkdir(workspace, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(workspace, 'ledger.json'), JSON.stringify(MARCH_LEDGER)),
    fs.writeFile(path.join(workspace, 'expenses.mjs'), EXPENSE_CLI),
    fs.writeFile(path.join(workspace, 'README.md'), [
      `# ${client} expense reporting playbook`,
      'These instructions belong to this client workspace; other clients may use different reporting rules.',
      'Use node expenses.mjs help to inspect the supported operations.',
      `Normalize the ledger to exclude unposted charges and duplicate receipts, summarize by ${group}, and verify the report against the original ledger.`,
      'Deliver expenses.csv only after verification succeeds.'
    ].join('\n'))
  ])
}

/**
 * Inspect the same persisted transcript that supplies subsequent model requests.
 */
export async function readExperienceTranscript(
  profilePath: string,
  sessionId: string
): Promise<AgentToolTranscriptMessage[]> {
  const state = JSON.parse(await fs.readFile(path.join(
    profilePath, 'sessions', sessionId, '.agent-conversation-state.json'
  ), 'utf8')) as { transcript: AgentToolTranscriptMessage[] }

  return state.transcript
}

/**
 * Verify explicit loading and full procedure injection in a fresh conversation.
 */
export function assertExperienceLoaded(
  transcript: AgentToolTranscriptMessage[],
  experience: { id: string, instructions: string },
  previousRequest: string
): void {
  assert.ok(!transcript.some((message) => message.role === 'user' &&
    !message.runtimeContext && message.content.includes(previousRequest)))
  assert.ok(transcript.some((message) => message.role === 'tool' && message.content.includes(experience.id)))
  assert.ok(transcript.some((message) => message.role === 'user' &&
    Array.isArray(message.runtimeContext?.['active_experiences']) &&
    message.runtimeContext['active_experiences'].some((entry: { id: string, instructions: string }) =>
      entry.id === experience.id && entry.instructions === experience.instructions
    )), 'The model must receive the complete saved procedure, not just its discovery card.')
}

/**
 * Read the application's audit trail to distinguish correct execution from retries.
 */
export async function readExpenseOperations(workspace: string): Promise<Array<{
  operation: string
  group?: string
}>> {
  return (await fs.readFile(path.join(workspace, 'operations.jsonl'), 'utf8')).trim()
    .split('\n').map((line) => JSON.parse(line))
}
