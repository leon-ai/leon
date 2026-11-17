import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

import { RUNTIME_RELEASE_ASSET, RUNTIME_SCHEMA_VERSION, REQUIRED_RUNTIME_PLATFORMS } from '../../bridges/runtime/contracts/distribution.js'

/**
 * Publishes a complete platform manifest only after every archive has passed
 * isolated startup, actual artifact OTA, profile and live inference checks.
 */
export async function collectRuntimeAssets(directory, verified, output) {
  const assets = []
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const folder = path.join(directory, entry.name)
    const metadata = JSON.parse(await fs.readFile(path.join(folder, RUNTIME_RELEASE_ASSET), 'utf8'))
    const startup = JSON.parse(await fs.readFile(path.join(folder, 'runtime-verification.json'), 'utf8'))
    const ota = JSON.parse(await fs.readFile(path.join(folder, 'runtime-ota-verification.json'), 'utf8'))
    assert.equal(metadata.schemaVersion, RUNTIME_SCHEMA_VERSION)
    assert.equal(metadata.version, verified.version)
    assert.equal(metadata.assets.length, 1)
    const asset = metadata.assets[0]
    assert(!assets.some((candidate) => candidate.platform === asset.platform), 'Duplicate runtime platform')
    assert.equal(asset.name, `leon-core-${verified.version}-${asset.platform}.tar.gz`)
    assert.equal(path.basename(asset.name), asset.name)
    for (const receipt of [startup, ota]) {
      assert.equal(receipt.version, verified.version)
      assert.equal(receipt.platform, asset.platform)
      assert.equal(receipt.commit, verified.commit)
      assert.equal(receipt.runId, verified.runId)
      assert.equal(receipt.sha256, asset.sha256)
    }
    assert.equal(startup.isolatedStartup, true)
    assert.equal(ota.artifactOTA, true)
    assert.equal(ota.profilePreserved, true)
    assert(ota.profilesVerified >= 2 && ota.sessionsVerified >= 2 && ota.workspacesVerified >= 2,
      'Existing conversations, workspaces and profile isolation must survive artifact OTA')
    assert.equal(ota.liveInference, true)
    assert(['upgrade', 'bootstrap'].includes(ota.mode), 'Missing artifact OTA verification')
    const file = path.join(folder, asset.name)
    assert.equal((await fs.stat(file)).size, asset.bytes)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) {
      hash.update(chunk)
    }
    assert.equal(hash.digest('hex'), asset.sha256)
    assets.push(asset)
    files.push(file)
  }
  assert(REQUIRED_RUNTIME_PLATFORMS.every((platform) => assets.some((asset) => asset.platform === platform)),
    'Every supported release platform must have a verified runtime archive')
  const manifest = path.join(output, RUNTIME_RELEASE_ASSET)
  await fs.writeFile(manifest, JSON.stringify({ schemaVersion: RUNTIME_SCHEMA_VERSION,
    version: verified.version, assets }, null, 2) + '\n')
  return [...files, manifest]
}
