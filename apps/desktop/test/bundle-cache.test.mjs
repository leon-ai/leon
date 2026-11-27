import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { bundleCacheKey, bundleOutputDigest, canReuseBundle } from '../scripts/bundle-cache.mjs'

for (const platform of ['linux', 'win32']) {
  test(`reuses a complete ${platform} build and rejects changed inputs or damaged output`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-cache-'))
    t.after(() => rm(root, { recursive: true, force: true }))

    const app = path.join(root, 'staging')
    const buildResources = path.join(root, 'packaging')
    const electronDist = path.join(root, 'electron')
    const output = path.join(root, 'unpacked')
    const resources = path.join(output, 'resources')
    const lockfile = path.join(root, 'pnpm-lock.yaml')
    const buildPath = path.join(root, 'build.json')
    const asset = path.join(app, 'index.html')
    const executableName = 'leon-desktop'
    const executable = path.join(output, `${executableName}${platform === 'win32' ? '.exe' : ''}`)
    const resource = path.join(resources, platform === 'linux' ? 'leon-icon-abc.png' : 'app.asar')
    const config = { directories: { app, buildResources }, electronDist }
    const build = { platform, output, bundleName: executableName, executableName,
      ...(platform === 'linux' ? { linuxLauncher: { icon: resource } } : {}) }

    await Promise.all([app, buildResources, electronDist, resources].map((directory) =>
      mkdir(directory, { recursive: true })))
    await Promise.all([
      writeFile(lockfile, 'locked tools'),
      writeFile(asset, 'version A'),
      writeFile(executable, 'runtime A'),
      writeFile(resource, 'packaged resource')
    ])

    const key = await bundleCacheKey(config, lockfile, null)
    const outputDigest = await bundleOutputDigest(build)
    assert.ok(key && outputDigest)
    await writeFile(buildPath, JSON.stringify({ ...build, bundleCache: { key, outputDigest } }))

    // A web rebuild can rewrite identical bytes with a new timestamp.
    const stamp = new Date(0)
    await utimes(asset, stamp, stamp)
    assert.equal(await bundleCacheKey(config, lockfile, null), key)
    assert.equal(await canReuseBundle(buildPath, key, build), true)

    await writeFile(asset, 'version B')
    const changedKey = await bundleCacheKey(config, lockfile, null)
    assert.notEqual(changedKey, key)
    assert.equal(await canReuseBundle(buildPath, changedKey, build), false)

    await writeFile(executable, 'runtime B')
    assert.equal(await canReuseBundle(buildPath, key, build), false)
    await writeFile(executable, 'runtime A')
    assert.equal(await canReuseBundle(buildPath, key, build), true)

    await rm(resource)
    assert.equal(await canReuseBundle(buildPath, key, build), false)
  })
}
