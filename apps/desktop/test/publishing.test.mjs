import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
const publisher = fileURLToPath(new URL('../scripts/publish-release.mjs', import.meta.url))

/**
 * Uses local artifact receipts and an observable gh substitute; it cannot
 * publish to a remote repository or access the owner's credentials.
 */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-publish-'))
  const bin = path.join(root, 'bin')
  const artifacts = path.join(root, 'artifacts')
  const log = path.join(root, 'calls.jsonl')
  await mkdir(bin)
  await mkdir(artifacts)
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.0' }))
  const script = path.join(bin, 'gh.mjs')
  await writeFile(script, `import fs from 'node:fs';
const args=process.argv.slice(2);const metadata=args.filter(a=>a.endsWith('.yml')&&fs.existsSync(a)).map(p=>fs.readFileSync(p,'utf8'));
fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({args,metadata})+'\\n');
if(args[0]==='api')console.log(args[1].includes('/git/') ? JSON.stringify({object:{type:'commit',sha:process.env.FIXTURE_RELEASE_COMMIT||'verified-commit'}}) : process.env.FIXTURE_RELEASES||'[]');`)
  await writeFile(path.join(bin, 'gh'), `#!/bin/sh\nexec '${process.execPath.replaceAll('\'', '\'\\\'\'')}' '${script.replaceAll('\'', '\'\\\'\'')}' "$@"\n`, { mode: 0o755 })
  const platforms = ['darwin-arm64', 'win32-x64', 'linux-x64', 'linux-arm64']
  for (const platform of platforms) {
    const folder = path.join(artifacts, platform)
    await mkdir(folder)
    const name = `leon-desktop-0.1.0-${platform}.zip`
    const bytes = Buffer.from(platform)
    const metadataName = platform.startsWith('darwin') ? 'latest-mac.yml' : platform.startsWith('win32') ? 'latest.yml'
      : platform === 'linux-x64' ? 'latest-linux.yml' : 'latest-linux-arm64.yml'
    const metadata = Buffer.from(`version: 0.1.0\nfiles:\n  - url: ${name}\n    sha512: ${createHash('sha512').update(bytes).digest('base64')}\npath: ${name}\n`)
    await writeFile(path.join(folder, name), bytes)
    await writeFile(path.join(folder, metadataName), metadata)
    await writeFile(path.join(folder, 'desktop-verification.json'), JSON.stringify({ version: '0.1.0', channel: 'preview',
      platform, commit: 'verified-commit', runId: 'verified-run', signed: !platform.startsWith('linux'), notarized: platform.startsWith('darwin'),
      files: [{ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
        { name: metadataName, bytes: metadata.length, sha256: createHash('sha256').update(metadata).digest('hex') }] }))
  }
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, LEON_HOME: path.join(root, 'home'),
    GITHUB_REPOSITORY: 'fixture/leon', GITHUB_SHA: 'verified-commit', GITHUB_RUN_ID: 'verified-run', GH_TOKEN: 'fixture-token', FIXTURE_LOG: log, FIXTURE_RELEASES: JSON.stringify([{ tag_name: 'v0.1.0', name: 'A new era begins', body: 'Shared Leon release notes.', draft: false, assets: [{ name: 'leon-runtime-assets.json' }] }]) }
  return { root, artifacts, log, env }
}

test('attaches installers to the matching product release before advancing app-update pointers', { skip: process.platform === 'win32' }, async () => {
  const f = await fixture()
  try {
    await execute(process.execPath, [publisher, f.artifacts], { cwd: f.root, env: f.env })
    const calls = (await readFile(f.log, 'utf8')).trim().split('\n').map(JSON.parse)
    const visible = calls.findIndex(({ args }) => args[1] === 'upload' && args[2] === 'v0.1.0')
    const pointer = calls.findIndex(({ args }) => args[1] === 'upload' && args[2] === 'desktop-preview')
    assert(visible >= 0 && pointer > visible)
    const feeds = calls[pointer].metadata
    assert.equal(feeds.length, 4)
    assert(feeds.every((body) => body.includes('https://github.com/fixture/leon/releases/download/v0.1.0/')))
    assert(feeds.every((body) => body.includes('Shared Leon release notes.')))
    assert(!calls.some(({ args }) => args[1] === 'create' && args[2] === 'v0.1.0'))
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('blocks modified installers and missing platforms before making publication writes', { skip: process.platform === 'win32' }, async () => {
  const f = await fixture()
  try {
    await rm(path.join(f.artifacts, 'linux-x64'), { recursive: true })
    await assert.rejects(execute(process.execPath, [publisher, f.artifacts], { cwd: f.root, env: f.env }), /platform checks/)
    await assert.rejects(readFile(f.log))
    await writeFile(path.join(f.artifacts, 'darwin-arm64', 'leon-desktop-0.1.0-darwin-arm64.zip'), 'tampered')
    await assert.rejects(execute(process.execPath, [publisher, f.artifacts], { cwd: f.root, env: f.env }))
    await assert.rejects(readFile(f.log))
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

for (const mismatch of ['version', 'commit']) {
  test(`refuses installer publication when the Core release ${mismatch} differs`, { skip: process.platform === 'win32' }, async () => {
    const f = await fixture()
    try {
      if (mismatch === 'version') {
        f.env.FIXTURE_RELEASES = '[]'
      } else {
        f.env.FIXTURE_RELEASE_COMMIT = 'another-commit'
      }
      await assert.rejects(execute(process.execPath, [publisher, f.artifacts], { cwd: f.root, env: f.env }),
        /matching verified Core release|exact Core release commit/)
      const calls = (await readFile(f.log, 'utf8')).trim().split('\n').map(JSON.parse)
      assert(calls.every(({ args }) => args[0] === 'api'))
    } finally {
      await rm(f.root, { recursive: true, force: true })
    }
  })
}
