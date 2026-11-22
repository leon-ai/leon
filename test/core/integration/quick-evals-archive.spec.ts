import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { expect, it } from 'vitest'

const execute = promisify(execFile)

it('archives concurrent eval attempts on a single branch and skips identical retries', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-quick-eval-repository-'))
  const repository = path.join(directory, 'reports.git')
  const script = path.resolve('scripts/ci/archive-quick-eval.js')
  const sha = 'a'.repeat(40)
  const env = { ...process.env, GITHUB_SHA: sha, GITHUB_RUN_ID: '42' }
  const archive = (file: string): Promise<unknown> => execute(process.execPath, [script, file, repository], { env })
  const git = async (...args: string[]): Promise<string> => (await execute('git', ['-C', repository, ...args])).stdout.trim()

  try {
    await execute('git', ['init', '--bare', repository])
    const files = await Promise.all([1, 2].map(async (attempt) => {
      const filename = path.join(directory, `attempt-${attempt}.json`)
      await fs.writeFile(filename, JSON.stringify({
        schemaVersion: 1, sha, version: '2.0.0-alpha.0.10', runId: '42', attempt, source: 'development',
        recordedAt: 1_800_000_000_000 + attempt, committedAt: 1_799_000_000_000,
        durationMs: 40_000, suiteRevision: 'b'.repeat(64),
        model: 'deepseek/deepseek-flash', reasoning: 'high',
        results: [{ scenario: 'selected-lookup', status: 'Failed', samples: [], failures: ['Private diagnostic'] }]
      }))
      return filename
    }))
    await Promise.all(files.map(archive))
    await archive(files[0]!)

    expect(await git('for-each-ref', '--format=%(refname)', 'refs/heads')).toBe('refs/heads/eval-history')
    expect(await git('rev-list', '--count', 'eval-history')).toBe('2')
    expect((await git('ls-tree', '-r', '--name-only', 'eval-history')).split('\n')).toEqual([
      `quick-evals/${sha}/42-1.json`, `quick-evals/${sha}/42-2.json`, 'quick-evals/index.json'
    ])
    const stored = await git('show', `eval-history:quick-evals/${sha}/42-1.json`)
    expect(JSON.parse(stored).committedAt).toBe(1_799_000_000_000)
    expect(JSON.parse(stored).results[0]).toEqual({ scenario: 'selected-lookup', status: 'Failed', samples: [] })
    const releaseFile = path.join(directory, 'release.json')
    await fs.writeFile(releaseFile, JSON.stringify({
      ...JSON.parse(stored), runId: '43', source: 'release', recordedAt: 1_800_000_000_003
    }))
    await execute(process.execPath, [script, releaseFile, repository], { env: { ...env, GITHUB_RUN_ID: '43', GITHUB_REF_TYPE: 'tag' } })
    const index = JSON.parse(await git('show', 'eval-history:quick-evals/index.json'))
    expect(index.runs.every(({ committedAt }: { committedAt: number }) => committedAt === 1_799_000_000_000)).toBe(true)
    expect(index.runs.map(({ source, runId, attempt }: { source: string, runId: string, attempt: number }) =>
      [source, runId, attempt])).toEqual([['release', '43', 1], ['development', '42', 2], ['development', '42', 1]])
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
