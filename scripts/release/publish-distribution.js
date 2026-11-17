import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { collectRuntimeAssets } from '../distribution/collect-assets.js'
import { RELEASE_ASSET_NAME } from '../../bridges/runtime/contracts/update-status.js'

const execute = promisify(execFile)
const COMMAND_TIMEOUT_MS = 60_000

/**
 * Publishes only the exact content and commit verified by this workflow run.
 * Uploads finish while the release is a draft so clients never see half a release.
 */
export async function publishDistribution() {
  const directory = process.env.LEON_RELEASE_OUTPUT
  const repository = process.env.GITHUB_REPOSITORY
  const token = process.env.GH_TOKEN
  assert(directory && repository && token, 'Release output, repository and publishing credentials are required')
  const run = async (name, args, timeout = COMMAND_TIMEOUT_MS) => (await execute(name, args, { timeout })).stdout.trim()
  const read = async (filename) => JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8'))
  const verified = await read('verification.json')
  const content = await read(RELEASE_ASSET_NAME)
  const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'))
  assert.equal(verified.runId, process.env.GITHUB_RUN_ID, 'The receipt must belong to this workflow run')
  assert.equal(verified.commit, process.env.GITHUB_SHA, 'The verified commit must match the release event')
  assert.equal(await run('git', ['rev-parse', 'HEAD']), verified.commit)
  assert.equal(verified.tag, process.env.GITHUB_REF_NAME)
  assert.equal(verified.tag, `v${manifest.version}`)
  assert.equal(verified.version, manifest.version)
  assert.equal(content.version, verified.version)
  assert(['upgrade', 'bootstrap'].includes(verified.mode), 'Missing successful OTA verification')
  const refs = (await run('git', ['ls-remote', 'origin', `refs/tags/${verified.tag}`, `refs/tags/${verified.tag}^{}`]))
    .split('\n').map((line) => line.split('\t'))
  const current = refs.find((ref) => ref[1]?.endsWith('^{}')) ?? refs.find((ref) => ref[1] === `refs/tags/${verified.tag}`)
  assert.equal(current?.[0], verified.commit, 'The release tag moved after verification')
  const runtimeFiles = process.env.LEON_RUNTIME_ASSETS
    ? await collectRuntimeAssets(process.env.LEON_RUNTIME_ASSETS, verified, directory) : []
  const endpoint = new URL(`/repos/${repository}/releases/tags/${encodeURIComponent(verified.tag)}`,
    process.env.GITHUB_API_URL || 'https://api.github.com')
  const existing = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) })
  if (existing.ok) {
    assert.equal((await existing.json()).draft, true, 'An already published release cannot be replaced')
  } else {
    assert.equal(existing.status, 404, 'Could not inspect the draft release')
    const args = ['release', 'create', verified.tag, '--repo', repository, '--verify-tag', '--draft',
      '--target', verified.commit, '--title', content.title, '--notes-file', path.join(directory, 'release-notes.md')]
    if (verified.version.includes('-')) {
      args.push('--prerelease')
    }
    await run('gh', args)
  }
  await run('gh', ['release', 'upload', verified.tag, path.join(directory, RELEASE_ASSET_NAME), ...runtimeFiles, '--repo', repository, '--clobber'], 15 * 60_000)
  await run('gh', ['release', 'edit', verified.tag, '--repo', repository, '--title', content.title,
    '--notes-file', path.join(directory, 'release-notes.md'), '--draft=false',
    `--prerelease=${verified.version.includes('-')}`, `--latest=${!verified.version.includes('-')}`])
  console.log(`Published verified release ${verified.tag}`)
}

if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  publishDistribution().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
