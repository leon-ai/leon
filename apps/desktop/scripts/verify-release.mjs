import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { fileDigest } from './file-digest.mjs'
import { YAML } from '../.generated/runtime/bootstrap-runtime.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const execute = promisify(execFile)
const BUILD = JSON.parse(await readFile(path.join(ROOT, '.artifacts/build.json'), 'utf8'))
const manifest = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'))
assert(BUILD.release && !BUILD.diagnostics, 'Only signed distribution builds can be verified for publication')
const output = path.dirname(BUILD.output)
const metadataName = process.platform === 'darwin' ? 'latest-mac.yml' : process.platform === 'win32' ? 'latest.yml'
  : `latest-linux${process.arch === 'x64' ? '' : `-${process.arch}`}.yml`
const metadata = YAML.parse(await readFile(path.join(output, metadataName), 'utf8'))
assert.equal(metadata.version, manifest.version)
if (process.platform === 'linux') {
  assert(metadata.files.some((file) => file.url.endsWith('.AppImage')), 'The Linux AppImage is missing')
  assert(metadata.files.some((file) => file.url.endsWith('.deb')), 'The Debian package is missing')
}
if (process.platform === 'darwin') {
  assert.equal(BUILD.arch, 'arm64', 'macOS releases support Apple Silicon only')
  assert(process.env.APPLE_TEAM_ID, 'APPLE_TEAM_ID is required to verify the macOS publisher')
  const app = path.join(BUILD.output, `${BUILD.bundleName}.app`)
  const identity = await execute('codesign', ['--display', '--verbose=4', app])
  const team = identity.stderr.split('\n').find((line) => line.startsWith('TeamIdentifier='))
  assert.equal(team, `TeamIdentifier=${process.env.APPLE_TEAM_ID}`, 'The macOS signing team does not match APPLE_TEAM_ID')
  await execute('codesign', ['--verify', '--deep', '--strict', app])
  await execute('xcrun', ['stapler', 'validate', app])
  await execute('spctl', ['--assess', '--type', 'execute', app])
} else if (process.platform === 'win32') {
  const installer = metadata.files.find((file) => file.url.endsWith('.exe'))
  assert(installer, 'The Windows installer is missing')
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(ROOT, 'packaging/verify-signature.ps1'),
    '-Path', path.join(output, installer.url)])
}
const files = []
for (const name of await readdir(output)) {
  if (!name.startsWith(`leon-desktop-${manifest.version}-`) && name !== metadataName) {
    continue
  }
  const filename = path.join(output, name)
  if (!(await stat(filename)).isFile()) {
    continue
  }
  files.push({ name, bytes: (await stat(filename)).size, sha256: await fileDigest(filename, 'sha256') })
}
for (const file of metadata.files) {
  assert.equal(path.basename(file.url), file.url, 'Update asset names must be relative leaf filenames')
  const filename = path.join(output, file.url)
  assert.equal(await fileDigest(filename, 'sha512', 'base64'), file.sha512)
  if (file.size !== undefined) {
    assert.equal((await stat(filename)).size, file.size)
  }
}
const receipt = { version: manifest.version, channel: BUILD.channel, platform: `${process.platform}-${process.arch}`,
  commit: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null,
  signed: process.platform !== 'linux', notarized: process.platform === 'darwin', files }
await writeFile(path.join(output, 'desktop-verification.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(`Verified ${receipt.platform}: ${files.length} distribution files`)
