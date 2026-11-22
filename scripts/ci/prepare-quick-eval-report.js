import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { publicQuickEvalReport, QUICK_EVAL_ASSET } from '../../server/src/core/insights/evaluation-report.js'

const [filename] = process.argv.slice(2)
const raw = JSON.parse(await fs.readFile(filename, 'utf8'))
assert.equal(raw.sha, process.env.GITHUB_SHA, 'The evaluation must match the workflow commit')
const report = publicQuickEvalReport(raw, {
  runId: process.env.GITHUB_RUN_ID,
  attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  source: process.env.GITHUB_REF_TYPE === 'tag' ? 'release' : 'development'
})
await fs.writeFile(path.join(path.dirname(filename), QUICK_EVAL_ASSET), `${JSON.stringify(report)}\n`)
