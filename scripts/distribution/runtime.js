import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { extract } from 'tar'
import semver from 'semver'

import { RUNTIME_MANIFEST, RUNTIME_RELEASE_ASSET, RUNTIME_SCHEMA_VERSION, RUNTIME_DIRECTORY } from '../../bridges/runtime/contracts/distribution.js'

export { RUNTIME_MANIFEST, RUNTIME_RELEASE_ASSET, RUNTIME_SCHEMA_VERSION, RUNTIME_DIRECTORY }
const MAXIMUM_METADATA_BYTES = 1_048_576
const MAXIMUM_EXTRACTED_BYTES = 8 * 1_024 * 1_024 * 1_024
const MAXIMUM_ARCHIVE_ENTRIES = 150_000
const MAXIMUM_VERSION_LENGTH = 128

/**
 * Validates versions before they become installation-directory names.
 */
export function validateRuntimeVersion(version) {
  assert(typeof version === 'string' && version.length <= MAXIMUM_VERSION_LENGTH &&
    semver.parse(version)?.raw === version, 'I received an invalid runtime version.')
  return version
}

/**
 * Provides one platform key for packaging, first install and server updates.
 */
export function runtimePlatform(platform = process.platform, architecture = process.arch) {
  assert(['darwin', 'win32', 'linux'].includes(platform) && ['arm64', 'x64'].includes(architecture),
    'I do not have a server runtime for this platform.')
  return `${platform}-${architecture}`
}

/**
 * Resolves version-local binaries without replacing a running shared runtime.
 */
export function runtimePaths(root, platform = process.platform) {
  return { root, node: path.join(root, 'runtime', 'node', platform === 'win32' ? 'node.exe' : 'bin/node'),
    pnpm: path.join(root, 'runtime', 'pnpm', platform === 'win32' ? 'pnpm.exe' : 'pnpm'),
    python: path.join(root, 'runtime', 'python', platform === 'win32' ? 'python.exe' : 'bin/python'),
    uv: path.join(root, 'runtime', 'uv', platform === 'win32' ? 'uv.exe' : 'uv'),
    jq: path.join(root, 'runtime', 'jq', platform === 'win32' ? 'jq.exe' : 'jq'),
    setup: path.join(root, 'server', 'dist', 'distribution-setup.js'),
    entry: path.join(root, 'server', 'dist', 'index.js'),
    frontend: path.join(root, 'apps', 'web', 'dist') }
}

/**
 * Publishes complete state while keeping an interrupted write recoverable.
 */
export async function writeRuntimeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

/**
 * Bounds release metadata before it can select a native executable payload.
 */
export async function readRuntimeMetadata(url, { signal } = {}) {
  const response = await fetch(url, { signal: AbortSignal.any([signal ?? new AbortController().signal,
    AbortSignal.timeout(30_000)]), headers: { Accept: 'application/json', 'User-Agent': 'Leon-Core' }, redirect: 'follow' })
  assert(response.ok, `I could not read runtime metadata (${response.status}).`)
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    assert(size <= MAXIMUM_METADATA_BYTES, 'Runtime metadata exceeds its size limit.')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Pins a release asset to its reviewed platform, version, size and checksum.
 */
export function selectRuntimeAsset(manifest, version, platform = runtimePlatform(), baseURL) {
  validateRuntimeVersion(version)
  assert(manifest?.schemaVersion === RUNTIME_SCHEMA_VERSION && manifest.version === version &&
    Array.isArray(manifest.assets), 'Runtime metadata does not match this release.')
  const matches = manifest.assets.filter((asset) => asset.platform === platform)
  assert(matches.length === 1, 'I do not have exactly one server archive for this platform.')
  const asset = matches[0]
  const expected = `leon-core-${version}-${platform}.tar.gz`
  assert(asset.name === expected && typeof asset.sha256 === 'string' && asset.sha256.length === 64 &&
    Buffer.from(asset.sha256, 'hex').length === 32 &&
    Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && asset.bytes <= MAXIMUM_EXTRACTED_BYTES,
  'The runtime archive metadata is incomplete.')
  const url = new URL(asset.name, baseURL)
  assert(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname),
    'Runtime archives require HTTPS or a local verification server.')
  return { ...asset, version, url: url.href }
}

/**
 * Resolves only complete, compatible releases inside the managed version store.
 */
export async function readInstalledRuntime(root, expected = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, RUNTIME_MANIFEST), 'utf8'))
  validateRuntimeVersion(manifest.version)
  assert(manifest.schemaVersion === RUNTIME_SCHEMA_VERSION && manifest.platform === (expected.platform ?? runtimePlatform()) &&
    (!expected.version || manifest.version === expected.version), 'The installed runtime is incompatible.')
  const paths = runtimePaths(root)
  const packageJSON = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  assert(packageJSON.version === manifest.version, 'The runtime code and manifest versions disagree.')
  for (const file of [paths.node, paths.pnpm, paths.setup, paths.entry, path.join(paths.frontend, 'index.html')]) {
    assert((await fs.stat(file)).isFile(), 'The server runtime is incomplete.')
  }
  return { ...paths, manifest }
}

/**
 * Keeps active selection outside immutable version directories and profile data.
 */
export async function currentRuntime(installation) {
  const active = JSON.parse(await fs.readFile(path.join(installation, 'active.json'), 'utf8'))
  const version = validateRuntimeVersion(active.version)
  return readInstalledRuntime(path.join(installation, 'versions', version), { version })
}

/**
 * Stages a checksum-verified archive without running source installs or builds.
 * The host supplies Leon's existing resumable downloader and receives byte progress.
 * @param {object} options
 * @param {string} options.installation
 * @param {{name: string, version: string, platform: string, bytes: number, sha256: string, url: string}} options.asset
 * @param {typeof import('../../bridges/runtime/nodejs/file-downloader').FileDownloader.downloadFile} options.download
 * @param {AbortSignal} [options.signal]
 * @param {(progress: import('../../bridges/runtime/nodejs/file-downloader').DownloadFileProgress) => void} [options.onProgress]
 * @param {(stage: string) => void | Promise<void>} [options.onStage]
 */
export async function installRuntimeArchive({ installation, asset, download, signal, onProgress, onStage }) {
  validateRuntimeVersion(asset.version)
  const destination = path.join(installation, 'versions', asset.version)
  const existing = await fs.stat(destination).catch((error) => {
    if (error.code !== 'ENOENT') {
      throw error
    }
    return null
  })
  if (existing) {
    const installed = await readInstalledRuntime(destination, { version: asset.version, platform: asset.platform })
    if (installed.manifest.archiveSHA256) {
      assert(installed.manifest.archiveSHA256 === asset.sha256, 'This runtime version was already installed from another archive.')
      return installed
    }
    // A crash during link restoration leaves an uncommitted directory. Only
    // inactive code may be discarded; profile data is outside this store.
    const active = await fs.readFile(path.join(installation, 'active.json'), 'utf8').then(JSON.parse).catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error
      }
      return null
    })
    assert(active?.version !== asset.version, 'My active runtime is incomplete and needs repair.')
    await fs.rm(destination, { recursive: true, force: true })
  }
  const cache = path.join(installation, 'downloads')
  await fs.mkdir(cache, { recursive: true, mode: 0o700 })
  const archive = path.join(cache, asset.name)
  await onStage?.('downloading')
  await download(asset.url, archive, { signal, cliProgress: false, skipExisting: false, onProgress })
  signal?.throwIfAborted()
  await onStage?.('verifying')
  assert((await fs.stat(archive)).size === asset.bytes, 'The runtime archive size does not match its release.')
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(archive)) {
    signal?.throwIfAborted()
    digest.update(chunk)
  }
  assert(digest.digest('hex') === asset.sha256, 'The runtime archive checksum does not match its release.')
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  const staging = await fs.mkdtemp(`${destination}.pending-`)
  try {
    await onStage?.('extracting')
    let bytes = 0
    let entries = 0
    let invalidEntry
    const unpack = extract({ cwd: staging, strict: true, preservePaths: false, chmod: true,
      filter(name, entry) {
        bytes += entry.size
        entries += 1
        const valid = bytes <= MAXIMUM_EXTRACTED_BYTES && entries <= MAXIMUM_ARCHIVE_ENTRIES &&
          !path.posix.isAbsolute(name) && !path.win32.isAbsolute(name) &&
          !name.split(/[\\/]/).includes('..') && ['File', 'Directory', 'Link', 'OldFile'].includes(entry.type)
        if (!valid) {
          invalidEntry = new Error('The runtime archive contains an unsafe or oversized entry.')
          return false
        }
        return true
      } })
    await pipeline(createReadStream(archive), unpack, { signal })
    signal?.throwIfAborted()
    if (invalidEntry) {
      throw invalidEntry
    }
    const installed = await readInstalledRuntime(staging, { version: asset.version, platform: asset.platform })
    // No live version is overwritten, including an executable locked by Windows.
    await fs.rename(staging, destination)
    try {
      await restoreRuntimeLinks(destination, installed.manifest)
      await writeRuntimeJSON(path.join(destination, RUNTIME_MANIFEST), { ...installed.manifest, archiveSHA256: asset.sha256 })
      await fs.rm(archive, { force: true })
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true })
      throw error
    }
    return readInstalledRuntime(destination, { version: asset.version, platform: asset.platform })
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

/**
 * Reclaims a stopped installer's lock while refusing a live process's work.
 * Hosts serialize launches before using this cross-process guard.
 */
export async function acquireRuntimeLock(file) {
  const owner = await fs.readFile(file, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') {
      throw error
    }
    return null
  })
  if (owner) {
    const pid = Number(owner)
    assert(Number.isSafeInteger(pid) && pid > 0, 'I could not validate the runtime installation lock.')
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error
      }
      await fs.rm(file)
    }
  }
  const lock = await fs.open(file, 'wx', 0o600)
  await lock.writeFile(String(process.pid))
  return async () => {
    await lock.close()
    await fs.rm(file, { force: true })
  }
}

/**
 * Changes only the runtime pointer; profile migrations keep their own receipts.
 */
export async function activateRuntime(installation, version) {
  await readInstalledRuntime(path.join(installation, 'versions', validateRuntimeVersion(version)), { version })
  const before = await fs.readFile(path.join(installation, 'active.json'), 'utf8').then(JSON.parse).catch((error) => {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  })
  await writeRuntimeJSON(path.join(installation, 'active.json'), { version, previous: before?.version ?? null })
}

/**
 * Keeps application runtimes version-local while preserving profile and tool paths.
 */
export function runtimeEnvironment(runtime, installation, environment = process.env) {
  const pathKey = Object.keys(environment).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
  return { ...environment, LEON_HOME: environment.LEON_HOME,
    LEON_RUNTIME_HOME: installation, LEON_CODEBASE_PATH: runtime.root,
    LEON_NODE_PATH: runtime.node, LEON_PNPM_PATH: runtime.pnpm,
    LEON_PYTHON_PATH: runtime.python, LEON_UV_PATH: runtime.uv, LEON_JQ_PATH: runtime.jq,
    LEON_MANAGED_LAUNCHER: 'true', LEON_NODE_ENV: 'production', LEON_OPEN_BROWSER: 'false',
    LEON_PUBLIC_BUILD_COMMIT: runtime.manifest.buildCommit ?? '',
    npm_package_version: runtime.manifest.version,
    [pathKey]: [path.dirname(runtime.node), path.dirname(runtime.pnpm), environment[pathKey] ?? ''].join(path.delimiter) }
}

/**
 * Restores archive-owned dependency links after the version directory is final.
 */
export async function restoreRuntimeLinks(destination, manifest) {
  for (const link of manifest.links ?? []) {
    const origin = path.resolve(destination, link.target)
    const target = path.resolve(destination, link.path)
    assert(origin.startsWith(`${destination}${path.sep}`) && target.startsWith(`${destination}${path.sep}`) &&
      !path.win32.isAbsolute(link.path) && !path.win32.isAbsolute(link.target), 'A runtime link leaves its version directory.')
    await fs.mkdir(path.dirname(target), { recursive: true })
    if (link.directory) {
      await fs.symlink(process.platform === 'win32' ? origin : path.relative(path.dirname(target), origin), target,
        process.platform === 'win32' ? 'junction' : 'dir')
    } else {
      await fs.copyFile(origin, target)
    }
  }
}

/**
 * Bounds installed versions while retaining recovery and any running launcher.
 * Windows may retain locked versions until the owning process has exited.
 */
export async function pruneRuntimeVersions(installation, executables = []) {
  const active = JSON.parse(await fs.readFile(path.join(installation, 'active.json'), 'utf8'))
  const versions = path.join(installation, 'versions')
  const keep = new Set([active.version, active.previous])
  for (const executable of executables.filter(Boolean)) {
    const relative = path.relative(versions, executable)
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      keep.add(relative.split(path.sep)[0])
    }
  }
  for (const entry of await fs.readdir(versions, { withFileTypes: true })) {
    if (!entry.isDirectory() || keep.has(entry.name) || !semver.valid(entry.name)) {
      continue
    }
    await fs.rm(path.join(versions, entry.name), { recursive: true, force: true }).catch((error) => {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) {
        throw error
      }
    })
  }
}
