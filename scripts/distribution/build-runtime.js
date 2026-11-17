import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { create } from 'tar'
import { copyRuntimeDependencies, runtimeDependencyLinks } from './dependencies.js'
import { RUNTIME_MANIFEST, RUNTIME_SCHEMA_VERSION, RUNTIME_RELEASE_ASSET, runtimePlatform } from './runtime.js'

const execute = promisify(execFile)
const SOURCE_DIRECTORIES = ['bin', 'core', 'tools', 'skills', 'bridges', 'tcp_server', 'schemas']
const ROOT_FILES = ['LICENSE.md', 'README.md', '.env.sample', 'config.sample.yml', 'uv.toml', 'pnpm-workspace.yaml']

/**
 * Packages the exact built release and production dependencies on its native
 * build worker. It never reads owner profiles or bundles optional model caches.
 */
export async function buildRuntime({ source = process.cwd(), output, home = process.env.LEON_HOME } = {}) {
  assert(output && home, 'Runtime output and an isolated build home are required')
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'))
  const versions = JSON.parse(await fs.readFile(path.join(source, 'bin/node/versions.json'), 'utf8'))
  assert.equal(process.versions.node, versions.node, 'Build native dependencies with the packaged Node version')
  const platform = runtimePlatform()
  const staging = await fs.mkdtemp(path.join(path.resolve(output), '.runtime-build-'))
  const payload = path.join(staging, 'payload')
  try {
    await fs.mkdir(payload)
    await copyRuntimeDependencies(source, path.join(payload, 'node_modules'))
    await fs.writeFile(path.join(payload, 'package.json'), JSON.stringify({ ...manifest,
      scripts: {}, devDependencies: undefined, pnpm: undefined }, null, 2))
    const tracked = (await execute('git', ['ls-files', '-z', ...SOURCE_DIRECTORIES, ...ROOT_FILES], { cwd: source,
      maxBuffer: 16 * 1_024 * 1_024 })).stdout.split('\0').filter(Boolean)
    for (const name of tracked) {
      const origin = path.join(source, name)
      const info = await fs.stat(origin).catch(() => null)
      if (!info?.isFile()) {
        continue
      }
      // Generated global defaults must come from samples, never local settings.
      if (name.startsWith('core/config/') && name.endsWith('.json') && !name.endsWith('.sample.json')) {
        continue
      }
      const destination = path.join(payload, name)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.copyFile(origin, destination)
      if (name.startsWith('core/config/') && name.endsWith('.sample.json')) {
        await fs.copyFile(origin, destination.replace('.sample.json', '.json'))
      }
    }
    for (const generated of ['core/data', 'schemas']) {
      await fs.cp(path.join(source, generated), path.join(payload, generated), { recursive: true })
    }
    await fs.cp(path.join(source, 'server/dist'), path.join(payload, 'server/dist'), { recursive: true })
    await fs.cp(path.join(source, 'apps/web/dist'), path.join(payload, 'apps/web/dist'), { recursive: true })
    await fs.mkdir(path.join(payload, 'scripts'), { recursive: true })
    for (const directory of ['distribution', 'update']) {
      await fs.cp(path.join(source, 'scripts', directory), path.join(payload, 'scripts', directory), { recursive: true })
    }
    for (const file of ['run-with-managed-node.js', 'run-runtime.js']) {
      await fs.copyFile(path.join(source, 'scripts', file), path.join(payload, 'scripts', file))
    }
    await fs.cp(path.join(source, 'bridges/runtime/contracts'), path.join(payload, 'bridges/runtime/contracts'), { recursive: true })
    // Source workers keep their bridge-owned dependencies, apart from Core's.
    await copyRuntimeDependencies(path.join(source, 'bridges/nodejs'), path.join(payload, 'bridges/nodejs/node_modules'))
    for (const name of ['node', 'pnpm', 'python', 'uv', 'jq']) {
      await fs.cp(path.join(home, 'bin', name), path.join(payload, 'runtime', name), { recursive: true, verbatimSymlinks: true })
    }
    const python = path.join(source, 'bridges/python/src/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    const packages = (await execute(python, ['-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'])).stdout.trim()
    await fs.cp(packages, path.join(payload, 'runtime/python-bridge/site-packages'), { recursive: true })
    // Restore links as junctions on Windows; extracting symlinks needs privileges.
    const links = await runtimeDependencyLinks(payload)
    await fs.writeFile(path.join(payload, RUNTIME_MANIFEST), JSON.stringify({ schemaVersion: RUNTIME_SCHEMA_VERSION,
      version: manifest.version, platform, nodeVersion: versions.node, links }, null, 2))
    const name = `leon-core-${manifest.version}-${platform}.tar.gz`
    const archive = path.join(output, name)
    await create({ file: archive, cwd: payload, gzip: true, portable: true, filter: (_name, info) => !info.isSymbolicLink() },
      await fs.readdir(payload))
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(archive)) {
      hash.update(chunk)
    }
    const asset = { platform, name, sha256: hash.digest('hex'), bytes: (await fs.stat(archive)).size }
    await fs.writeFile(path.join(output, RUNTIME_RELEASE_ASSET), JSON.stringify({ schemaVersion: RUNTIME_SCHEMA_VERSION,
      version: manifest.version, assets: [asset] }, null, 2))
    return asset
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  const output = path.resolve(process.argv[2])
  await fs.mkdir(output, { recursive: true })
  await buildRuntime({ output })
}
