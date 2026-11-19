import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

import { parse, stringify } from 'yaml'

import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { readStoredProfileToken, PROFILE_TOKEN_HEADER_NAME } from '@/core/profile-auth'
import { LEON_PROFILE_NAME, PROFILE_TOKEN_SEPARATOR } from '@/leon-roots'
import { UpdatePhase, type UpdateSnapshot } from '../../bridges/runtime/contracts/updates'
import { RELEASE_ASSET_NAME, RELEASE_SOURCE_NAME, formatReleaseNotes, isPreviewVersion, selectPreviousDistribution,
  validateReleaseContent, type PublishedDistribution } from '../release/release-content'
import { getFullInstallEnvironment } from '../setup/setup-ci.js'
import { forwardSafeOutput, stopProcessGroup } from './test-fresh-install.js'

const execute = promisify(execFile)
const COMMAND_TIMEOUT_MS = 60_000
const INSTALL_TIMEOUT_MS = 45 * 60_000
const START_TIMEOUT_MS = 3 * 60_000
const OTA_TIMEOUT_MS = 40 * 60_000
const REQUEST_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 1_000
const BOOTSTRAP_VERSION = '0.0.0-ota.0'

/**
 * Boots a published installation, updates it through its public HTTP API, and
 * proves the installed server can still perform a real authenticated inference.
 */
export async function verifyReleaseOTA(): Promise<void> {
  const source = fs.realpathSync(process.cwd())
  const home = process.env['LEON_HOME']
  const output = process.env['LEON_RELEASE_OUTPUT']
  assert(home && path.isAbsolute(home), 'An isolated absolute LEON_HOME is required')
  assert(output && path.isAbsolute(output), 'LEON_RELEASE_OUTPUT is required')
  assert(process.env['LEON_FRESH_INSTALL_API_KEY'], 'The live inference secret is required')
  assert(!fs.existsSync(home) || fs.readdirSync(home).length === 0, 'OTA verification requires an empty Leon home')
  fs.mkdirSync(home, { recursive: true })
  const installed = path.join(home, 'checkout')
  const fixturePath = path.join(home, 'candidate.json')
  const bootsPath = path.join(home, 'boots.jsonl')
  const log = fs.createWriteStream(process.env['LEON_OTA_LOG_PATH'] ?? path.join(home, 'ota.log'))
  const env: NodeJS.ProcessEnv = { ...getFullInstallEnvironment(), LEON_HOME: home, LEON_CODEBASE_PATH: installed,
    LEON_OPEN_BROWSER: 'false', CI: 'true' }
  // Previous releases may still use the provider marker to select setup shortcuts.
  delete env['GITHUB_ACTIONS']
  delete env['NODE_OPTIONS']
  delete env['IS_DOCKER']
  let server: ReturnType<typeof spawn> | undefined
  let activeCommand: ReturnType<typeof spawn> | undefined
  let interrupted = false
  const stop = (): void => {
    interrupted = true
    if (server) {
      stopProcessGroup(server)
    }
    if (activeCommand) {
      stopProcessGroup(activeCommand)
    }
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const command = async (name: string, args: string[], cwd = source): Promise<string> =>
    (await execute(name, args, { cwd, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 32 * 1_048_576 })).stdout.trim()
  const git = (args: string[], cwd = source): Promise<string> => command('git', args, cwd)
  const run = (name: string, args: string[], cwd = installed, timeout = INSTALL_TIMEOUT_MS): Promise<void> =>
    new Promise((resolve, reject) => {
      const child = spawn(name, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      activeCommand = child
      forwardSafeOutput(child.stdout!, process.stdout, log)
      forwardSafeOutput(child.stderr!, process.stderr, log)
      const timer = setTimeout(() => stopProcessGroup(child, 'SIGKILL'), timeout)
      child.once('error', (error) => {
        clearTimeout(timer)
        activeCommand = undefined
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        activeCommand = undefined
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`${name} failed during OTA verification (${code ?? 'signal'})`))
        }
      })
    })

  try {
    const version = (JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')) as { version: string }).version
    const tag = process.env['GITHUB_REF_NAME'] ?? `v${version}`
    const commit = await git(['rev-parse', 'HEAD'])
    assert.equal(commit, process.env['GITHUB_SHA'] ?? commit, 'Verify the exact release commit')
    assert.equal(await git(['rev-parse', `${tag}^{commit}`]), commit, 'The candidate tag must resolve to the tested commit')
    const content = validateReleaseContent(JSON.parse(fs.readFileSync(path.join(source, RELEASE_SOURCE_NAME), 'utf8')), version, tag)
    const repository = process.env['GITHUB_REPOSITORY']
    assert(repository, 'GITHUB_REPOSITORY is required')
    const pages = JSON.parse(await command('gh', ['api', '--paginate', '--slurp',
      `repos/${repository}/releases?per_page=100`])) as PublishedDistribution[][]
    const previous = selectPreviousDistribution(pages.flat(), version)
    let upstream = source
    let before = previous?.tag_name ?? BOOTSTRAP_VERSION

    if (!previous) {
      // No published version can yet run OTA. Seed a clearly identified smoke
      // upgrade from candidate source; never claim this tests a legacy upgrade.
      upstream = path.join(home, 'bootstrap-source')
      fs.mkdirSync(upstream)
      const archive = path.join(home, 'source.tar')
      await git(['archive', '--format=tar', `--output=${archive}`, commit])
      await command('tar', ['-xf', archive, '-C', upstream])
      await git(['init', '-b', 'main'], upstream)
      await git(['config', 'user.name', 'Leon OTA verification'], upstream)
      await git(['config', 'user.email', 'ota@example.invalid'], upstream)
      const manifestPath = path.join(upstream, 'package.json')
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: before }, null, 2)}\n`)
      await git(['add', '.'], upstream)
      await git(['commit', '--no-verify', '-m', 'Bootstrap OTA installation'], upstream)
      before = await git(['rev-parse', 'HEAD'], upstream)
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      await git(['add', 'package.json'], upstream)
      await git(['commit', '--no-verify', '-m', 'Candidate OTA installation'], upstream)
      await git(['tag', tag], upstream)
    }
    await command('git', ['clone', '--no-hardlinks', '--no-checkout', upstream, installed])
    await git(['checkout', '--detach', before], installed)
    const originalHead = await git(['rev-parse', 'HEAD'], installed)
    const targetHead = await git(['rev-parse', `${tag}^{commit}`], installed)
    if (previous) {
      assert.equal(targetHead, commit, 'The update must install the real candidate commit')
    }
    const installedVersion = (JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')) as { version: string }).version
    await run('pnpm', ['install', '--frozen-lockfile'])
    await run('pnpm', ['exec', 'tsx', 'scripts/ci/fresh-install-inferences.ts', 'configure'])
    const profile = getProfilePaths(LEON_PROFILE_NAME)
    const config = parse(fs.readFileSync(profile.config, 'utf8'))
    config.client_interface.auth.enabled = true
    config.telemetry_enabled = false
    config.runtime.pulse_enabled = false
    config.context.disabled_files = ['*']
    fs.writeFileSync(profile.config, stringify(config))
    const token = readStoredProfileToken(LEON_PROFILE_NAME)
    assert(token, 'Setup must create a persistent profile token')
    const url = new URL(config.server.host)
    url.port = String(config.server.port)
    const headers = { [PROFILE_TOKEN_HEADER_NAME]: `${LEON_PROFILE_NAME}${PROFILE_TOKEN_SEPARATOR}${token}`,
      'Content-Type': 'application/json' }
    const request = async <T>(resource: string, body?: unknown): Promise<T> => {
      const response = await fetch(new URL(`/api/v1/${resource}`, url), {
        method: body === undefined ? 'GET' : 'POST', headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      assert(response.ok, `Leon ${resource} returned HTTP ${response.status}`)

      return response.json() as Promise<T>
    }
    const published = { tag_name: tag, name: content.title, published_at: new Date().toISOString(),
      body: formatReleaseNotes(content), html_url: `https://github.com/${repository}/releases/tag/${tag}`,
      draft: false, prerelease: isPreviewVersion(version) }
    const fixture = { repository: upstream, boots: bootsPath, releases: [published] }
    fs.writeFileSync(fixturePath, JSON.stringify(fixture))
    const bootstrap = pathToFileURL(path.join(source, 'scripts', 'ci', 'ota-server-bootstrap.js')).href
    server = spawn('pnpm', ['start'], { cwd: installed, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...env, LEON_OTA_FIXTURE: fixturePath, NODE_OPTIONS: `--import=${bootstrap}`
    } })
    forwardSafeOutput(server.stdout!, process.stdout, log)
    forwardSafeOutput(server.stderr!, process.stderr, log)
    const wait = async (label: string, check: () => Promise<boolean>, timeout: number): Promise<void> => {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        assert(!interrupted && server?.exitCode === null && server.signalCode === null, 'The managed server exited unexpectedly')
        try {
          if (await check()) {
            return
          }
        } catch (error) {
          // Core's expected restart outage is temporary; an explicit failed
          // receipt is authoritative and must never be hidden by reconnects.
          if (error instanceof Error && error.name === 'OTAInstallationError') {
            throw error
          }
        }
        await delay(POLL_INTERVAL_MS)
      }
      throw new Error(`${label} timed out`)
    }
    await wait('Initial server startup', async () =>
      (await request<{ version: string }>('info')).version === installedVersion, START_TIMEOUT_MS)
    assert.equal(await git(['rev-parse', 'HEAD'], installed), originalHead)
    const sessionId = randomUUID()
    await request('sessions?compact=true', { id: sessionId })
    const check = await request<UpdateSnapshot>('updates/check', {})
    assert.equal(check.check?.release?.tag, tag, 'The running installation must discover the candidate')
    assert.equal(check.check?.canInstall, true, check.check?.reason ?? 'The baseline must support OTA')
    const accepted = await request<UpdateSnapshot>('updates/apply', { tag })
    assert.equal(accepted.state?.phase, UpdatePhase.Scheduled)
    await wait('OTA installation and restart', async () => {
      const status = await request<UpdateSnapshot>('updates')
      if (status.state?.phase === UpdatePhase.Failed) {
        const failure = new Error(status.state.error ?? 'OTA installation failed')
        failure.name = 'OTAInstallationError'
        throw failure
      }

      return status.state?.id === accepted.state?.id && status.state?.phase === UpdatePhase.Completed
    }, OTA_TIMEOUT_MS)
    assert.equal(await git(['rev-parse', 'HEAD'], installed), targetHead)
    assert.equal((await request<{ version: string }>('info')).version, version)
    assert.equal(readStoredProfileToken(LEON_PROFILE_NAME), token, 'The profile credential must survive the update')
    const sessions = await request<{ sessions: { id: string }[] }>('sessions')
    assert(sessions.sessions.some((session) => session.id === sessionId), 'The existing session must survive the update')
    const boots = fs.readFileSync(bootsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { pid: number, version: string })
    assert.equal(boots.length, 2, 'OTA must restart Core exactly once')
    assert.notEqual(boots[0]!.pid, boots[1]!.pid)
    assert.deepEqual(boots.map((boot) => boot.version), [installedVersion, version])
    const challenge = randomUUID()
    const ping = await request<{ output: string, usedOutputTokens: number }>('inference', {
      prompt: `Reply with exactly this text: ${challenge}`, temperature: 0,
      maxTokens: 128, disableThinking: true
    })
    assert.equal(ping.output.trim(), challenge, 'The restarted server must answer the live LLM challenge')
    assert(ping.usedOutputTokens > 0, 'The LLM must report generated tokens')
    // A preview must stay eligible for another preview after installing one.
    fixture.releases = [{ ...published, tag_name: `${tag}.1` }]
    fs.writeFileSync(fixturePath, JSON.stringify(fixture))
    if (isPreviewVersion(content.version)) {
      assert.equal((await request<UpdateSnapshot>('updates/check', {})).check?.release?.tag, `${tag}.1`)
    }
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, RELEASE_ASSET_NAME), `${JSON.stringify(content, null, 2)}\n`)
    fs.writeFileSync(path.join(output, 'release-notes.md'), formatReleaseNotes(content))
    fs.writeFileSync(path.join(output, 'verification.json'), `${JSON.stringify({ commit, tag, version,
      baseVersion: installedVersion, mode: previous ? 'upgrade' : 'bootstrap', runId: process.env['GITHUB_RUN_ID'] })}\n`)
    console.log(`OTA ${previous ? 'upgrade' : 'bootstrap'} and live inference passed: ${installedVersion} -> ${version}`)
  } finally {
    if (server) {
      stopProcessGroup(server)
      await new Promise<void>((resolve) => {
        if (server!.exitCode !== null || server!.signalCode !== null) {
          resolve()
          return
        }
        const timer = setTimeout(() => {
          stopProcessGroup(server, 'SIGKILL')
          resolve()
        }, 5_000)
        server!.once('close', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    log.end()
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  verifyReleaseOTA().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
