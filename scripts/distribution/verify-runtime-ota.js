import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { createReadStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'

import { parse, stringify } from 'yaml'
import { parse as parseEnvironment } from 'dotenv'
import semver from 'semver'

import { FileDownloader } from '../../server/dist/bridges/runtime/nodejs/file-downloader.js'
import { RUNTIME_MANIFEST, RUNTIME_RELEASE_ASSET, runtimePlatform, installRuntimeArchive,
  activateRuntime, runtimeEnvironment, readInstalledRuntime, readRuntimeMetadata, selectRuntimeAsset,
  restoreRuntimeLinks, writeRuntimeJSON } from './runtime.js'

const BOOTSTRAP_VERSION = '0.0.0-runtime.0'
const TIMEOUT_MS = 180_000

/**
 * Runs the actual Core HTTP apply flow against built releases. The first archive
 * release records a synthetic older baseline; published predecessors are reused.
 */
export async function verifyRuntimeOTA(directory) {
  const source = process.cwd()
  const metadata = JSON.parse(await fs.readFile(path.join(directory, RUNTIME_RELEASE_ASSET), 'utf8'))
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-runtime-ota-'))
  const installation = path.join(home, 'runtimes/core')
  const fixturePath = path.join(home, 'release.json')
  const download = FileDownloader.downloadFile.bind(FileDownloader)
  let server
  let child
  let output = ''
  try {
    let previous = null
    if (process.env.GITHUB_REPOSITORY) {
      const releases = await readRuntimeMetadata(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/releases?per_page=100`)
      previous = releases.filter((release) => !release.draft && semver.valid(release.tag_name) &&
        Boolean(semver.prerelease(release.tag_name)) === Boolean(semver.prerelease(metadata.version)) &&
        semver.lt(release.tag_name, metadata.version) &&
        release.assets.some((asset) => asset.name === RUNTIME_RELEASE_ASSET) &&
        release.assets.some((asset) => asset.name === `leon-core-${semver.valid(release.tag_name)}-${runtimePlatform()}.tar.gz`))
        .sort((a, b) => semver.rcompare(a.tag_name, b.tag_name))[0] ?? null
    }
    let initial
    if (previous) {
      const baseURL = `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/download/${previous.tag_name}/`
      const prior = await readRuntimeMetadata(new URL(RUNTIME_RELEASE_ASSET, baseURL))
      initial = await installRuntimeArchive({ installation, asset: selectRuntimeAsset(prior,
        semver.valid(previous.tag_name), runtimePlatform(), baseURL), download })
    } else {
      const bootstrap = await installRuntimeArchive({ installation: path.join(home, 'bootstrap'), asset: {
        ...metadata.assets[0], version: metadata.version, url: path.join(directory, metadata.assets[0].name)
      }, download })
      const root = path.join(installation, 'versions', BOOTSTRAP_VERSION)
      await fs.mkdir(path.dirname(root), { recursive: true })
      await fs.cp(bootstrap.root, root, { recursive: true,
        filter: async (name) => !(await fs.lstat(name)).isSymbolicLink() })
      const manifest = { ...bootstrap.manifest, version: BOOTSTRAP_VERSION }
      await writeRuntimeJSON(path.join(root, RUNTIME_MANIFEST), manifest)
      const packageJSON = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
      await writeRuntimeJSON(path.join(root, 'package.json'), { ...packageJSON, version: BOOTSTRAP_VERSION })
      await restoreRuntimeLinks(root, manifest)
      initial = await readInstalledRuntime(root)
    }
    const profile = 'runtime-ota'
    const profileRoot = path.join(home, 'profiles', profile)
    await fs.mkdir(profileRoot, { recursive: true })
    const config = parse(await fs.readFile(path.join(initial.root, 'config.sample.yml'), 'utf8'))
    const portProbe = http.createServer()
    await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
    const port = portProbe.address().port
    await new Promise((resolve) => portProbe.close(resolve))
    config.server.port = port
    config.telemetry_enabled = false
    config.runtime.pulse_enabled = false
    config.context.disabled_files = ['*']
    config.client_interface.auth.enabled = true
    const token = randomUUID()
    await fs.writeFile(path.join(profileRoot, 'config.yml'), stringify(config))
    await fs.writeFile(path.join(profileRoot, '.env'), `LEON_PROFILE_TOKEN=${token}\n`, { mode: 0o600 })
    const other = { profile: `${profile}-other`, token: randomUUID() }
    const otherRoot = path.join(home, 'profiles', other.profile)
    await fs.mkdir(otherRoot, { recursive: true })
    await fs.writeFile(path.join(otherRoot, 'config.yml'), stringify(config))
    await fs.writeFile(path.join(otherRoot, '.env'), `LEON_PROFILE_TOKEN=${other.token}\n`, { mode: 0o600 })
    await activateRuntime(installation, initial.manifest.version)
    const env = runtimeEnvironment(initial, installation, { ...process.env, LEON_HOME: home, LEON_PROFILE: profile, UV_CACHE_DIR: path.join(home, 'cache/uv') })
    const execute = (command, args, workingDirectory = initial.root, environment = env) => new Promise((resolve, reject) => {
      const process = spawn(command, args, { cwd: workingDirectory, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      process.stdout.on('data', (chunk) => {
        output = (output + chunk).slice(-16_384)
      })
      process.stderr.on('data', (chunk) => {
        output = (output + chunk).slice(-16_384)
      })
      process.once('error', reject)
      process.once('close', (code) => code === 0 ? resolve() : reject(new Error(output)))
    })
    await execute(initial.node, [initial.setup])
    await execute(initial.node, [initial.setup], initial.root, { ...env, LEON_PROFILE: other.profile })
    if (process.env.LEON_FRESH_INSTALL_API_KEY) {
      // Reuse the existing provider/profile configuration used by fresh-install gates.
      const tsx = fileURLToPath(import.meta.resolve('tsx/cli'))
      await execute(process.execPath, [tsx, 'scripts/ci/fresh-install-inferences.ts', 'configure'], source)
    } else {
      assert(process.env.CI !== 'true', 'A release runtime needs the live inference gate secret')
    }
    server = http.createServer((request, response) => {
      const file = path.join(directory, metadata.assets[0].name)
      response.writeHead(200, { 'content-length': metadata.assets[0].bytes })
      if (request.method === 'HEAD') {
        response.end()
      } else {
        void pipeline(createReadStream(file), response).catch(() => response.destroy())
      }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const baseURL = `http://127.0.0.1:${server.address().port}/`
    await writeRuntimeJSON(fixturePath, { manifest: metadata, baseURL, releases: [{ tag_name: `v${metadata.version}`,
      name: 'Verified Core release', published_at: new Date().toISOString(), body: 'A built Core release.',
      html_url: `${baseURL}release`, draft: false, prerelease: Boolean(semver.prerelease(metadata.version)) }] })
    child = spawn(initial.node, [path.join(initial.root, 'scripts/run-runtime.js')], { cwd: initial.root,
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env,
        LEON_RUNTIME_FIXTURE: fixturePath, NODE_OPTIONS: `--import=${pathToFileURL(path.join(source, 'scripts/ci/runtime-server-bootstrap.js')).href}` } })
    const closed = new Promise((resolve) => child.once('close', resolve))
    child.stdout.on('data', (chunk) => {
      output = (output + chunk).slice(-16_384)
    })
    child.stderr.on('data', (chunk) => {
      output = (output + chunk).slice(-16_384)
    })
    const request = async (resource, body, identity = { profile, token }, method = body === undefined ? 'GET' : 'POST') => {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/${resource}`, {
        method, headers: { 'content-type': 'application/json',
          'x-leon-profile-token': `${identity.profile}:${identity.token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      assert(response.ok, `Packaged Core returned ${response.status} for ${resource}: ${output}`)
      return response.json()
    }
    const until = async (probe) => {
      const deadline = Date.now() + TIMEOUT_MS
      while (Date.now() < deadline && child.exitCode === null) {
        try {
          const value = await probe()
          if (value) {
            return value
          }
        } catch (error) {
          if (error.cause === 'terminal') {
            throw error
          }
          // Brief connection failures are expected while the actual server restarts.
        }
        await delay(100)
      }
      throw new Error(`Runtime verification timed out: ${output}`)
    }
    try {
      await until(() => request('profile-auth'))
      // Exercise durable owner data in two authenticated profiles. An empty
      // profile and a surviving token alone cannot establish data preservation.
      const preserved = []
      for (const identity of [{ profile, token }, other]) {
        const input = { name: `Preserved project ${identity.profile}`, brief: randomUUID(), resources: [] }
        const { workspace } = await request('workspaces', input, identity)
        const id = randomUUID()
        await request('sessions?compact=true', { id, workspace_id: workspace.id }, identity)
        const title = `Preserved conversation ${randomUUID()}`
        await request(`sessions/${id}?compact=true`, { title, is_pinned: true }, identity, 'PATCH')
        const environment = parseEnvironment(await fs.readFile(path.join(home, 'profiles', identity.profile, '.env'), 'utf8'))
        preserved.push({ identity, workspace, environment, session: { id, title, workspaceId: workspace.id, isPinned: true } })
      }
      const check = await request('updates/check', {})
      assert(check.check.canInstall && semver.eq(check.check.release.version, metadata.version), 'The old runtime must offer the exact candidate')
      const accepted = await request('updates/apply', { tag: `v${metadata.version}` })
      await until(async () => {
        const snapshot = await request('updates')
        if (snapshot.state?.phase === 'failed') {
          throw new Error(`${snapshot.state.error}: ${output}`, { cause: 'terminal' })
        }
        return snapshot.state?.id === accepted.state.id && snapshot.state?.phase === 'completed'
      })
      assert.equal(JSON.parse(await fs.readFile(path.join(installation, 'active.json'), 'utf8')).version, metadata.version)
      assert((await fs.readFile(path.join(profileRoot, '.env'), 'utf8')).includes(token), 'Profile credentials must survive Core replacement')
      assert((await fs.readFile(path.join(otherRoot, '.env'), 'utf8')).includes(other.token), 'Other profile credentials must survive Core replacement')
      for (const item of preserved) {
        const environment = parseEnvironment(await fs.readFile(path.join(home, 'profiles', item.identity.profile, '.env'), 'utf8'))
        for (const [key, value] of Object.entries(item.environment)) {
          assert.equal(environment[key], value, 'Profile secrets must survive Core replacement')
        }
        const { workspaces } = await request('workspaces', undefined, item.identity)
        const workspace = workspaces.find((value) => value.id === item.workspace.id)
        assert(workspace, 'The existing workspace must survive Core replacement')
        for (const field of ['name', 'brief', 'resources']) {
          assert.deepEqual(workspace[field], item.workspace[field])
        }
        const { sessions } = await request(`sessions?workspace_id=${item.workspace.id}`, undefined, item.identity)
        const session = sessions.find((value) => value.id === item.session.id)
        assert(session, 'The existing conversation must survive Core replacement')
        for (const [key, value] of Object.entries(item.session)) {
          assert.deepEqual(session[key], value)
        }
        const otherWorkspace = preserved.find((value) => value !== item).workspace.id
        assert(!workspaces.some((value) => value.id === otherWorkspace), 'Profiles must remain isolated after Core replacement')
      }
      if (process.env.LEON_FRESH_INSTALL_API_KEY) {
        const challenge = randomUUID()
        const ping = await request('inference', { prompt: `Reply with exactly this text: ${challenge}`,
          temperature: 0, maxTokens: 128, disableThinking: true })
        assert.equal(ping.output.trim(), challenge)
        assert(ping.usedOutputTokens > 0)
      }
      const result = { version: metadata.version, platform: metadata.assets[0].platform,
        sha256: metadata.assets[0].sha256, commit: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null,
        mode: previous ? 'upgrade' : 'bootstrap', liveInference: Boolean(process.env.LEON_FRESH_INSTALL_API_KEY),
        profilePreserved: true, profilesVerified: preserved.length,
        sessionsVerified: preserved.length, workspacesVerified: preserved.length, artifactOTA: true }
      await writeRuntimeJSON(path.join(directory, 'runtime-ota-verification.json'), result)
      return result
    } finally {
      child.kill('SIGTERM')
      await closed
    }
  } finally {
    server?.closeAllConnections()
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve))
    }
    await fs.rm(home, { recursive: true, force: true })
  }
}

if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  console.log(JSON.stringify(await verifyRuntimeOTA(path.resolve(process.argv[2])), null, 2))
}
