import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  publicQuickEvalReport, QUICK_EVAL_ARCHIVE_PATH, QUICK_EVAL_BRANCH, QUICK_EVAL_INDEX, QUICK_EVAL_SCHEMA, summarizeQuickEvalReport
} from '../../server/src/core/insights/evaluation-report.js'

const GIT_TIMEOUT_MS = 30_000
const PUSH_ATTEMPTS = 4
const REF = `refs/heads/${QUICK_EVAL_BRANCH}`
const git = promisify(execFile)
const [filename, remote] = process.argv.slice(2)
const input = JSON.parse(await fs.readFile(filename, 'utf8'))
const source = process.env.GITHUB_REF_TYPE === 'tag' ? 'release' : 'development'
assert.equal(input.sha, process.env.GITHUB_SHA, 'The evaluation must match the workflow commit')
assert.equal(input.runId, process.env.GITHUB_RUN_ID, 'The evaluation must come from this workflow run')
assert.equal(input.source, source, 'The evaluation source must match the workflow')
assert(remote, 'An archive repository is required')

const report = publicQuickEvalReport(input, input)
const content = `${JSON.stringify(report)}\n`
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-quick-eval-archive-'))
const run = async (...args) => (await git('git', args, { cwd: scratch, timeout: GIT_TIMEOUT_MS })).stdout.trim()
const directory = path.join(scratch, 'quick-evals', report.sha)
const destination = path.join(directory, `${report.runId}-${report.attempt}.json`)
const indexFile = path.join(scratch, QUICK_EVAL_INDEX)
const summary = summarizeQuickEvalReport(report)

async function readOptional(filename) {
  return fs.readFile(filename, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') {
      throw error
    }
    return null
  })
}

async function readIndex() {
  const stored = await readOptional(indexFile)
  if (stored) {
    const index = JSON.parse(stored)
    assert.equal(index.schemaVersion, QUICK_EVAL_SCHEMA, 'Unknown Quick Evals index schema')
    return index
  }

  // An archive may already contain individual reports before the first index.
  const reports = (await run('ls-files', 'quick-evals')).split('\n').filter((entry) => QUICK_EVAL_ARCHIVE_PATH.test(entry))
  const runs = await Promise.all(reports.map(async (entry) => {
    const report = JSON.parse(await fs.readFile(path.join(scratch, entry), 'utf8'))
    return summarizeQuickEvalReport(publicQuickEvalReport(report, report))
  }))
  return { schemaVersion: QUICK_EVAL_SCHEMA, runs }
}

try {
  // An independent Git history keeps generated reports and their revisions
  // available without bringing source files into the archive.
  await run('init', '-b', QUICK_EVAL_BRANCH)
  await run('remote', 'add', 'origin', remote)
  for (let retry = 0; retry < PUSH_ATTEMPTS; retry++) {
    if (await run('ls-remote', '--heads', 'origin', REF)) {
      await run('fetch', '--depth=1', 'origin', REF)
      await run('reset', '--hard', 'FETCH_HEAD')
    }
    const existing = await readOptional(destination)
    if (existing !== null) {
      assert.equal(existing === content, true, 'This evaluation identity already has a different report')
    }
    const index = await readIndex()
    if (existing !== null && index.runs.some(({ id }) => id === summary.id) && await readOptional(indexFile)) {
      break
    }
    if (!index.runs.some(({ id }) => id === summary.id)) {
      index.runs.push(summary)
    }
    index.runs.sort((first, second) => second.recordedAt - first.recordedAt || first.id.localeCompare(second.id))
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(destination, content)
    await fs.writeFile(indexFile, `${JSON.stringify(index)}\n`)
    await run('add', '--', path.relative(scratch, destination), QUICK_EVAL_INDEX)
    await run('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit', '-m', `Archive Quick Evals run ${report.runId} attempt ${report.attempt}`)
    try {
      await run('push', 'origin', `HEAD:${REF}`)
      break
    } catch (error) {
      if (retry + 1 === PUSH_ATTEMPTS) {
        throw error
      }
      // Retry from the new remote tip if another job added a report first.
    }
  }
} finally {
  await fs.rm(scratch, { recursive: true, force: true })
}
