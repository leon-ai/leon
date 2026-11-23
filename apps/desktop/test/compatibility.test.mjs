import assert from 'node:assert/strict'
import { test } from 'node:test'
import semver from 'semver'

import contract from '../.generated/runtime/bootstrap-contract.mjs'
import { assertCoreCompatibility, findCoreAsset } from '../.generated/src/compatibility.js'
import { DESKTOP_CORE_PROTOCOL_VERSION } from '../../../bridges/runtime/contracts/distribution.js'

const major = semver.major(contract.sourceVersion)
const platform = 'linux-arm64'
const compatible = `${major}.1.0`
const release = (version, target = platform, overrides = {}) => ({
  tag_name: `v${version}`, draft: false, prerelease: Boolean(semver.prerelease(version)),
  assets: [{ name: 'leon-runtime-assets.json' }, { name: `leon-core-${version}-${target}.tar.gz` }], ...overrides
})
const manifest = (version, protocol = DESKTOP_CORE_PROTOCOL_VERSION) => ({
  schemaVersion: 1, version, desktopProtocolVersion: protocol,
  assets: [{ name: `leon-core-${version}-${platform}.tar.gz`, platform, bytes: 1_024, sha256: 'ab'.repeat(32) }]
})

test('accepts supported Core versions and rejects unknown protocols, older code and breaking releases', () => {
  assertCoreCompatibility({ version: contract.sourceVersion, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION })
  assertCoreCompatibility({ version: contract.minimumVersion, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION })
  assertCoreCompatibility({ version: compatible, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION })
  for (const value of [{}, { version: compatible },
    { version: compatible, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION + 1 },
    { version: `${major - 1}.0.0`, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION },
    { version: `${major + 1}.0.0-alpha.1`, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION }]) {
    assert.throws(() => assertCoreCompatibility(value), /compatible Leon Core/)
  }
})

test('selects the newest eligible platform archive while skipping drafts, missing platforms and incompatible protocols', async () => {
  const versions = [`${major}.4.0`, `${major}.3.0`, `${major}.2.0`, compatible]
  const inspected = []
  const result = await findCoreAsset([
    release(`${major + 1}.0.0`), release(versions[0], platform, { draft: true }),
    release(versions[1], 'win32-x64'), release(versions[2]), release(compatible)
  ], async (url) => {
    const version = decodeURIComponent(url.pathname.split('/').at(-2)).slice(1)
    inspected.push(version)
    return manifest(version, version === versions[2] ? DESKTOP_CORE_PROTOCOL_VERSION + 1 : DESKTOP_CORE_PROTOCOL_VERSION)
  }, platform)
  assert.equal(result.version, compatible)
  assert.equal(result.platform, platform)
  assert.deepEqual(inspected, [versions[2], compatible])
  assert.ok(result.url.endsWith(`leon-core-${compatible}-${platform}.tar.gz`))
})

test('fails clearly without a compatible release and refuses malformed archive integrity metadata', async () => {
  await assert.rejects(findCoreAsset([], async () => {}, platform), /No compatible prebuilt Core/)
  await assert.rejects(findCoreAsset([release(compatible)], async () => {
    const value = manifest(compatible)
    value.assets[0].sha256 = 'invalid'
    return value
  }, platform), /metadata is incomplete/)
})

test('stable discovery excludes prereleases even when their GitHub flag is incorrect', async () => {
  const channel = contract.channel
  contract.channel = 'stable'
  try {
    const result = await findCoreAsset([release(`${major}.2.0-alpha.1`, platform, { prerelease: false }), release(compatible)],
      async () => manifest(compatible), platform)
    assert.equal(result.version, compatible)
  } finally {
    contract.channel = channel
  }
})
