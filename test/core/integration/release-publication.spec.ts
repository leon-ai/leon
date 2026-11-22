import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { afterEach, beforeEach, expect, it } from 'vitest'

const execute = promisify(execFile)
const VERSION = '2.0.0-alpha.0.2'
const TAG = `v${VERSION}`
let root: string
let commit: string
let api: http.Server
let env: NodeJS.ProcessEnv
let statePath: string
let evaluationPath: string
const git = async (...args: string[]): Promise<string> =>
  (await execute('git', args, { cwd: root })).stdout.trim()

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-publication-'))
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: VERSION }))
  await git('init', '-b', 'main')
  await git('config', 'user.name', 'Release fixture')
  await git('config', 'user.email', 'release@example.invalid')
  await git('add', 'package.json')
  await git('commit', '-m', 'Release source')
  commit = await git('rev-parse', 'HEAD')
  await git('tag', '-a', TAG, '-m', 'Candidate')
  await git('remote', 'add', 'origin', root)
  const directory = path.join(root, 'verified')
  await fs.mkdir(directory)
  await fs.writeFile(path.join(directory, 'leon-release.json'), JSON.stringify({ version: VERSION, title: 'A quieter home' }))
  await fs.writeFile(path.join(directory, 'release-notes.md'), 'My latest improvements.\n')
  await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify({ commit, tag: TAG, version: VERSION,
    runId: '42', mode: 'upgrade' }))
  evaluationPath = path.join(directory, 'leon-quick-evals.json')
  await fs.writeFile(evaluationPath, JSON.stringify({
    schemaVersion: 1, sha: commit, version: VERSION, runId: '42', attempt: 1, source: 'release',
    recordedAt: 1_800_000_000_000, durationMs: 40_000, suiteRevision: 'a'.repeat(64),
    model: 'deepseek/deepseek-flash', reasoning: 'high',
    results: [{ scenario: 'selected-lookup', status: 'Passed', samples: [] }]
  }))
  statePath = path.join(root, 'published.json')
  const executable = path.join(root, 'bin', 'gh')
  await fs.mkdir(path.dirname(executable))
  // The fake CLI owns a local release with the same draft/upload/publish
  // boundaries as GitHub; no command can contact or mutate a real repository.
  await fs.writeFile(executable, `#!${process.execPath}
    const fs = require('node:fs');
    const file = process.env.RELEASE_FIXTURE_STATE;
    const args = process.argv.slice(2);
    let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : null;
    const action = args[1];
    if (action === 'create') {
      if (state || !args.includes('--draft')) process.exit(1);
      state = { draft: true, uploaded: false, actions: [] };
    } else if (!state?.draft) process.exit(1);
    if (action === 'upload') {
      const content = JSON.parse(fs.readFileSync(args[3]));
      if (content.version !== '${VERSION}') process.exit(1);
      const evaluation = JSON.parse(fs.readFileSync(args[4]));
      if (evaluation.sha !== process.env.GITHUB_SHA || evaluation.version !== '${VERSION}') process.exit(1);
      state.uploaded = true;
    }
    if (action === 'edit') {
      if (!state.uploaded || !args.includes('--draft=false') || !args.includes('--prerelease=true') || !args.includes('--latest=false')) process.exit(1);
      state.draft = false;
    }
    state.actions.push(action);
    fs.writeFileSync(file, JSON.stringify(state));
  `, { mode: 0o755 })
  api = http.createServer(async (request, response) => {
    expect(request.headers.authorization).toBe('Bearer fixture-token')
    try {
      response.setHeader('Content-Type', 'application/json')
      response.end(await fs.readFile(statePath, 'utf8'))
    } catch {
      response.statusCode = 404
      response.end('{}')
    }
  })
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve))
  env = { ...process.env, GH_TOKEN: 'fixture-token', GITHUB_REPOSITORY: 'fixture/leon', GITHUB_RUN_ID: '42',
    GITHUB_SHA: commit, GITHUB_REF_NAME: TAG, LEON_RELEASE_OUTPUT: directory,
    GITHUB_API_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}`,
    RELEASE_FIXTURE_STATE: statePath, PATH: `${path.dirname(executable)}${path.delimiter}${process.env['PATH'] ?? ''}` }
})

afterEach(async () => {
  await new Promise<void>((resolve) => api.close(() => resolve()))
  await fs.rm(root, { recursive: true, force: true })
})

const publish = (): Promise<unknown> => execute(process.execPath, [path.resolve('scripts/release/publish-distribution.js')],
  { cwd: root, env })

it.skipIf(process.platform === 'win32')('uploads verified content while private and publishes the completed prerelease afterward', async () => {
  await publish()
  expect(JSON.parse(await fs.readFile(statePath, 'utf8'))).toEqual({ draft: false, uploaded: true,
    actions: ['create', 'upload', 'edit'] })
})

it.skipIf(process.platform === 'win32')('blocks unverified content, changed tags and replacement of an already public release', async () => {
  env['GITHUB_RUN_ID'] = 'another-run'
  await expect(publish()).rejects.toThrow('receipt')
  await expect(fs.access(statePath)).rejects.toThrow()
  env['GITHUB_RUN_ID'] = '42'
  await git('commit', '--allow-empty', '-m', 'A different source revision')
  await git('tag', '-f', TAG)
  // Restore the checked-out commit while leaving the remote tag changed.
  await git('checkout', '--detach', commit)
  await expect(publish()).rejects.toThrow('tag moved')
  await expect(fs.access(statePath)).rejects.toThrow()
  await git('tag', '-f', TAG, commit)
  await fs.writeFile(statePath, JSON.stringify({ draft: false, uploaded: true }))
  await expect(publish()).rejects.toThrow('already published')
  expect(JSON.parse(await fs.readFile(statePath, 'utf8'))).toEqual({ draft: false, uploaded: true })
})

it.skipIf(process.platform === 'win32')('rejects evaluation measurements from a different commit before creating a release', async () => {
  const evaluation = JSON.parse(await fs.readFile(evaluationPath, 'utf8'))
  await fs.writeFile(evaluationPath, JSON.stringify({ ...evaluation, sha: 'b'.repeat(40) }))

  await expect(publish()).rejects.toThrow('evaluation must match the release commit')
  await expect(fs.access(statePath)).rejects.toThrow()
})
