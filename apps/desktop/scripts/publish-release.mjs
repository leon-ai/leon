import assert from 'node:assert/strict'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'

import { fileDigest } from './file-digest.mjs'
import { YAML, semver, RUNTIME_RELEASE_ASSET } from '../.generated/runtime/bootstrap-runtime.mjs'

const execute = promisify(execFile)
const PLATFORMS = ['darwin-arm64', 'win32-x64', 'linux-x64', 'linux-arm64']
const directory = path.resolve(process.argv[2])
const version = JSON.parse(await readFile('package.json', 'utf8')).version
const channel = process.env.LEON_DESKTOP_CHANNEL ?? 'preview'
const repository = process.env.GITHUB_REPOSITORY
assert(repository && process.env.GH_TOKEN && process.env.GITHUB_SHA && process.env.GITHUB_RUN_ID,
  'Publication requires the verified GitHub workflow identity')
assert(['preview', 'stable'].includes(channel), 'Unknown desktop channel')
assert(semver.valid(version), 'Invalid desktop version')
const tag = `v${version}`
const feedTag = `desktop-${channel}`
const run = async (...args) => (await execute('gh', args, { timeout: 15 * 60_000, maxBuffer: 1_048_576 })).stdout.trim()
const temporary = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-publication-'))
try {
  const assets = []
  const feeds = []
  const seen = new Set()
  for (const folder of await readdir(directory, { withFileTypes: true })) {
    if (!folder.isDirectory()) {
      continue
    }
    const root = path.join(directory, folder.name)
    const receipt = JSON.parse(await readFile(path.join(root, 'desktop-verification.json'), 'utf8'))
    assert.equal(receipt.version, version)
    assert.equal(receipt.channel, channel)
    assert.equal(receipt.commit, process.env.GITHUB_SHA)
    assert.equal(receipt.runId, process.env.GITHUB_RUN_ID)
    assert(PLATFORMS.includes(receipt.platform) && !seen.has(receipt.platform), 'Unexpected or duplicated platform')
    seen.add(receipt.platform)
    assert(receipt.platform.startsWith('linux-') || receipt.signed, 'Native signing verification is required')
    assert(receipt.platform !== 'darwin-arm64' || receipt.notarized, 'macOS notarization is required')
    for (const file of receipt.files) {
      assert.equal(path.basename(file.name), file.name)
      const filename = path.join(root, file.name)
      assert.equal((await stat(filename)).size, file.bytes)
      assert.equal(await fileDigest(filename, 'sha256'), file.sha256)
      if (file.name.endsWith('.yml')) {
        const metadata = YAML.parse(await readFile(filename, 'utf8'))
        assert.equal(metadata.version, version)
        const base = `https://github.com/${repository}/releases/download/${tag}/`
        for (const item of metadata.files) {
          assert.equal(path.basename(item.url), item.url)
          assert(receipt.files.some((candidate) => candidate.name === item.url), 'The update payload was not verified')
          item.url = new URL(item.url, base).href
        }
        if (metadata.path) {
          assert.equal(path.basename(metadata.path), metadata.path)
          metadata.path = new URL(metadata.path, base).href
        }
        const feed = path.join(temporary, file.name)
        await writeFile(feed, YAML.stringify(metadata))
        feeds.push(feed)
      } else {
        assets.push(filename)
      }
    }
  }
  assert(PLATFORMS.every((platform) => seen.has(platform)), 'All desktop platform checks are required')
  // The server owns product release notes and the immutable version tag. Native
  // artifacts join that exact release before its app-update pointer advances.
  const existing = await run('api', `repos/${repository}/releases?per_page=100`)
  const releases = JSON.parse(existing)
  const release = releases.find((item) => item.tag_name === tag && !item.draft &&
    item.assets?.some((asset) => asset.name === RUNTIME_RELEASE_ASSET))
  assert(release, 'Publish the matching verified server release before attaching desktop installers')
  let reference = JSON.parse(await run('api', `repos/${repository}/git/ref/tags/${tag}`)).object
  while (reference.type === 'tag') {
    reference = JSON.parse(await run('api', `repos/${repository}/git/tags/${reference.sha}`)).object
  }
  assert(reference.type === 'commit' && reference.sha === process.env.GITHUB_SHA,
    'Desktop installers must come from the exact server release commit')
  const prior = releases.find((release) => release.tag_name === feedTag)
  if (prior?.body) {
    const publishedVersion = prior.body.trim()
    assert(semver.valid(publishedVersion) && semver.gt(version, publishedVersion), 'Desktop versions must advance their channel')
  }
  const missing = []
  for (const filename of assets) {
    const existing = release.assets.find((asset) => asset.name === path.basename(filename))
    if (existing) {
      assert(existing.size === (await stat(filename)).size &&
        existing.digest === `sha256:${await fileDigest(filename, 'sha256')}`,
      'An existing product release asset cannot be replaced')
    } else {
      missing.push(filename)
    }
  }
  if (missing.length) {
    await run('release', 'upload', tag, ...missing, '--repo', repository)
  }
  for (const filename of feeds) {
    const metadata = YAML.parse(await readFile(filename, 'utf8'))
    metadata.releaseName = release.name ?? `Leon ${version}`
    metadata.releaseNotes = String(release.body ?? '').slice(0, 100_000)
    await writeFile(filename, YAML.stringify(metadata))
  }
  if (!prior) {
    await run('release', 'create', feedTag, '--repo', repository, '--target', process.env.GITHUB_SHA,
      '--title', `Desktop ${channel} update feed`, '--notes', version, '--prerelease', '--latest=false')
  }
  await run('release', 'upload', feedTag, ...feeds, '--repo', repository, '--clobber')
  await run('release', 'edit', feedTag, '--repo', repository, '--notes', version)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
