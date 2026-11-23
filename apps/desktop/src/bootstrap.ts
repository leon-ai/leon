import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { LEON_HOME_PATH, LEON_PROFILE_NAME, getProfilePaths, YAML, dotenv,
  FileDownloader, readRuntimeMetadata, installRuntimeArchive,
  currentRuntime, activateRuntime, runtimeEnvironment, acquireRuntimeLock, getUpdateStatePath, UPDATE_STAGE_LABELS } from '../runtime/bootstrap-runtime.mjs'
import contract from '../runtime/bootstrap-contract.mjs'
import { createProgressStore, SetupPhase, type ProgressStore } from './progress.js'
import { runCommand } from './process.js'
import { controlCore, createCoreService, type CoreService } from './service.js'
import { assertCoreCompatibility, CoreCompatibilityError, findCoreAsset, type PublishedRuntime } from './compatibility.js'
import { DESKTOP_CORE_PROTOCOL_VERSION } from '../../../bridges/runtime/contracts/desktop-client'
import type { CoreRuntime, RuntimeAsset } from '../runtime/bootstrap-runtime.mjs'
import type { HostError, ServiceConfiguration } from './types.js'
import type { UpdateState, UpdateJob } from '../../../bridges/runtime/contracts/updates'

interface BootstrapDependencies {
  probe?: typeof coreReady
  command?: typeof runCommand
  service?: typeof createCoreService
  asset?: (signal: AbortSignal) => Promise<RuntimeAsset>
}
interface InstallationSettings {
  codebase?: string
  runtimeHome?: string
  startAtLogin?: boolean
}
export interface BootstrapController {
  store: ProgressStore
  start: () => Promise<void>
  cancel: () => void
  setStartup: (enabled: boolean) => Promise<void>
  stop: () => Promise<void>
  updateState: () => Promise<UpdateState | null>
  frontend: () => Promise<string | undefined>
  readonly log: string | undefined
  close: () => Promise<void>
}

const STARTUP_TIMEOUT_MS = 120_000
const READY_INTERVAL_MS = 500
const MAXIMUM_READINESS_BYTES = 16_384

/**
 * Uses the small public authentication endpoint without loading profile content.
 */
export async function coreReady(origin: string | undefined, signal?: AbortSignal): Promise<boolean> {
  if (!origin) {
    return false
  }
  try {
    const response = await fetch(new URL('/api/v1/profile-auth', origin), {
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(2_000)]), redirect: 'error'
    })
    if (!response.ok || !response.body) {
      return false
    }
    let size = 0
    const chunks = []
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > MAXIMUM_READINESS_BYTES) {
        return false
      }
      chunks.push(chunk)
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof value.authenticated !== 'boolean' || !(value.profile_name === null || typeof value.profile_name === 'string')) {
      return false
    }
    assertCoreCompatibility(value)
    return true
  } catch (error) {
    if (error instanceof CoreCompatibilityError) {
      throw error
    }
    return false
  }
}

/**
 * Resolves the same profile port for the gateway and its managed Core process.
 */
export async function profileOrigin(): Promise<string> {
  const config = await readFile(getProfilePaths().config, 'utf8').then(YAML.parse).catch((error) => {
    if ((error as HostError).code === 'ENOENT') {
      return {}
    }
    throw error
  })
  const port = config?.server?.port ?? contract.defaultPort
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('My profile server port is invalid')
  }
  return `http://127.0.0.1:${port}`
}

/**
 * Installs built Core releases into a shared version store, independent of the
 * desktop bundle and owner profiles. Host-only adapters support local fixtures.
 */
export async function createBootstrap({ dependencies = {}, origin }: {
  dependencies?: BootstrapDependencies
  origin?: string | undefined
} = {}): Promise<BootstrapController> {
  const home = LEON_HOME_PATH
  const directory = path.join(home, 'desktop')
  const installation = path.join(home, 'runtimes', 'core')
  const settingsPath = path.join(directory, 'installation.json')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const saved: InstallationSettings = await readFile(settingsPath, 'utf8').then(JSON.parse).catch((error) => {
    if ((error as HostError).code === 'ENOENT') {
      return {}
    }
    throw error
  })
  const store = createProgressStore()
  store.addSecrets(await readFile(getProfilePaths().dotEnv, 'utf8').then(dotenv.parse).catch((error) => {
    if ((error as HostError).code === 'ENOENT') {
      return {}
    }
    throw error
  }))
  store.update({ installation: saved.codebase ?? null, service: saved.startAtLogin === true })
  const probe = dependencies.probe ?? coreReady
  const command = dependencies.command ?? runCommand
  const persist = (): Promise<void> => writeFile(settingsPath, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 })
  let operation: AbortController | undefined
  let pending: Promise<void> | undefined
  let service: CoreService | undefined
  let server: string | undefined
  let activeRuntime: CoreRuntime | null = null

  async function step<T>(id: string, label: string, execute: () => Promise<T>): Promise<T> {
    store.step(id, label, { phase: SetupPhase.Running, value: null, total: null })
    const result = await execute()
    operation!.signal.throwIfAborted()
    store.step(id, label, { phase: SetupPhase.Complete })
    return result
  }

  async function releaseAsset(signal: AbortSignal): Promise<RuntimeAsset> {
    const repository = new URL(contract.repository).pathname.slice(1)
    const releases = await readRuntimeMetadata(`https://api.github.com/repos/${repository}/releases?per_page=100`, { signal }) as PublishedRuntime[]
    return findCoreAsset(releases, (url) => readRuntimeMetadata(url, { signal }))
  }

  async function run(): Promise<void> {
    const signal = operation!.signal
    let lock: (() => Promise<void>) | undefined
    let started = false
    const lockPath = path.join(directory, 'install.lock')
    try {
      // The application lock serializes UI launches; this also protects installers.
      lock = await acquireRuntimeLock(lockPath)
      store.update({ phase: SetupPhase.Running, steps: [], error: null })
      server = origin ?? await profileOrigin()
      if (await step('instance', 'Checking my local instance', () => probe(server, signal))) {
        const config: ServiceConfiguration | null = await readFile(path.join(directory, 'service/core.json'), 'utf8').then(JSON.parse).catch(() => null)
        if (!origin && config && await controlCore(config)) {
          service = await (dependencies.service ?? createCoreService)({ ...config, home, profile: LEON_PROFILE_NAME })
        }
        store.update({ phase: SetupPhase.Complete, external: !service, server })
        return
      }
      if (origin) {
        throw new Error('I could not reach the selected Core. Start it, then retry connecting.')
      }
      let codebase: string
      let node: string
      let pnpm: string
      let runtimeHome: string | undefined
      const sourcePath = process.env['LEON_CODEBASE_PATH'] || (!saved.runtimeHome ? saved.codebase : null)
      if (sourcePath) {
        codebase = await realpath(sourcePath)
        await step('source', 'Checking my existing installation', async () => {
          const source = JSON.parse(await readFile(path.join(codebase, 'package.json'), 'utf8'))
          // The running endpoint also verifies the actual compiled protocol.
          assertCoreCompatibility({ version: source.version, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION })
          await stat(path.join(codebase, 'server/dist/index.js'))
          await stat(path.join(codebase, 'apps/web/dist/index.html'))
          await stat(path.join(codebase, 'scripts/run-with-managed-node.js'))
        })
        node = path.join(home, 'bin/node', process.platform === 'win32' ? 'node.exe' : 'bin/node')
        pnpm = path.join(home, 'bin/pnpm', process.platform === 'win32' ? 'pnpm.exe' : 'pnpm')
      } else {
        activeRuntime = await currentRuntime(installation).catch((error) => {
          if ((error as HostError).code === 'ENOENT') {
            return null
          }
          throw error
        })
        if (activeRuntime) {
          assertCoreCompatibility({ version: activeRuntime.manifest.version,
            desktop_protocol_version: activeRuntime.manifest.desktopProtocolVersion })
        } else {
          const asset = await step('release', 'Finding my Core release', () => (dependencies.asset ?? releaseAsset)(signal))
          let installationStage: 'download' | 'verifying' | 'extracting' = 'download'
          activeRuntime = await step('download', 'Downloading and verifying my Core', () => installRuntimeArchive({
            installation, asset, signal, download: FileDownloader.downloadFile.bind(FileDownloader),
            onStage: (stage) => {
              if (stage !== 'downloading') {
                store.step(installationStage, installationStage === 'download' ? 'Downloading my Core' : UPDATE_STAGE_LABELS[installationStage], { phase: SetupPhase.Complete })
                installationStage = stage
                store.step(stage, UPDATE_STAGE_LABELS[stage], { phase: SetupPhase.Running, value: null, total: null })
              }
            },
            onProgress: (value) => store.step('download', 'Downloading my Core', {
              value: value.downloadedBytes, total: value.totalBytes, sublabel: asset.name })
          }))
          // Verify the archive's own contract before profile setup or activation.
          assertCoreCompatibility({ version: activeRuntime.manifest.version,
            desktop_protocol_version: activeRuntime.manifest.desktopProtocolVersion })
          store.step(installationStage, installationStage === 'download' ? 'Downloading my Core' : UPDATE_STAGE_LABELS[installationStage], { phase: SetupPhase.Complete })
          await step('prepare', 'Preparing my profiles', () => command(activeRuntime!.node, [activeRuntime!.setup], {
            cwd: activeRuntime!.root, env: { ...runtimeEnvironment(activeRuntime!, installation), LEON_SETUP_PROGRESS: 'json' },
            signal, onLine: (line) => {
              try {
                const event = JSON.parse(line)
                if (event.kind === 'leon:setup' && event.id && event.label) {
                  store.step(`prepare:${event.id}`, event.label, { phase: event.phase === 'message' ? SetupPhase.Complete : event.phase })
                  return
                }
              } catch {
                // Non-structured subprocess details remain available on demand.
              }
              store.detail('prepare', line)
            }
          }))
          await activateRuntime(installation, activeRuntime.manifest.version)
        }
        codebase = activeRuntime.root
        node = activeRuntime.node
        pnpm = activeRuntime.pnpm
        runtimeHome = installation
      }
      service = await (dependencies.service ?? createCoreService)({ home, codebase, node, pnpm, runtimeHome, profile: LEON_PROFILE_NAME })
      started = !await controlCore(service.configuration)
      await step('start', 'Starting my Core', () => service!.start())
      store.update({ logAvailable: true })
      server = await profileOrigin()
      await step('ready', 'Waiting for my server', async () => {
        const deadline = Date.now() + STARTUP_TIMEOUT_MS
        while (!await probe(server, signal)) {
          if (Date.now() > deadline) {
            throw new Error('My server did not become ready. Open Core logs, then retry.')
          }
          await delay(READY_INTERVAL_MS, undefined, { signal })
        }
      })
      Object.assign(saved, { codebase, runtimeHome })
      await persist()
      store.update({ phase: SetupPhase.Complete, external: false, server, installation: codebase })
    } catch (error) {
      for (const item of store.state.steps) {
        if (item.phase === SetupPhase.Running) {
          store.step(item.id, item.label, { phase: signal.aborted ? SetupPhase.Cancelled : SetupPhase.Failed })
        }
      }
      store.update({ phase: signal.aborted ? SetupPhase.Cancelled : SetupPhase.Failed, error: store.redact(error instanceof Error ? error.message : error) })
      if (signal.aborted && started && service) {
        await controlCore(service.configuration, 'stop')
      }
    } finally {
      if (lock) {
        await lock()
      }
      operation = undefined
    }
  }

  const controller: BootstrapController = { store,
    start(): Promise<void> {
      if (operation) {
        throw new Error('Setup is already running')
      }
      operation = new AbortController()
      pending = run()
      return pending
    },
    cancel(): void {
      operation?.abort(new Error('I cancelled setup. My profiles and completed runtime versions are preserved.'))
    },
    async setStartup(enabled: boolean): Promise<void> {
      if (!service || store.state.external) {
        throw new Error('Startup is available only for my managed local instance')
      }
      await service.setStartup(enabled)
      saved.startAtLogin = enabled
      await persist()
      store.update({ service: enabled })
    },
    async stop(): Promise<void> {
      if (!service || store.state.external) {
        throw new Error('I can stop only the Core started by this desktop installation')
      }
      if (saved.startAtLogin) {
        await service.setStartup(false, { keepRunning: false })
        saved.startAtLogin = false
        await persist()
      }
      await controlCore(service.configuration, 'stop')
      store.update({ phase: SetupPhase.Idle, server: null, service: false })
    },
    async updateState(): Promise<UpdateState | null> {
      const config = service?.configuration
      if (!config) {
        return null
      }
      const job: UpdateJob | null = await readFile(getUpdateStatePath(home, config.codebase, config.runtimeHome), 'utf8').then(JSON.parse).catch((error) => {
        if ((error as HostError).code !== 'ENOENT') {
          throw error
        }
        return null
      })
      return job ? { id: job.id, phase: job.phase, version: job.version, error: job.error,
        progress: job.progress ?? null, steps: job.steps ?? [] } : null
    },
    async frontend(): Promise<string | undefined> {
      if (store.state.phase !== SetupPhase.Complete) {
        return undefined
      }
      const runtimeHome = service?.configuration.runtimeHome
      if (runtimeHome) {
        const selection = JSON.parse(await readFile(path.join(runtimeHome, 'active.json'), 'utf8'))
        // Static requests need only the tiny selection pointer. Revalidate the
        // full dependency manifest once when Core activates another version.
        if (activeRuntime?.manifest.version !== selection.version) {
          activeRuntime = await currentRuntime(runtimeHome)
          assertCoreCompatibility({ version: activeRuntime.manifest.version,
            desktop_protocol_version: activeRuntime.manifest.desktopProtocolVersion })
        }
        return activeRuntime!.frontend
      }
      return service ? path.join(service.configuration.codebase, 'apps/web/dist') : undefined
    },
    get log(): string | undefined {
      return service?.log
    },
    async close(): Promise<void> {
      this.cancel()
      await pending
      store.close()
    }
  }

  return controller
}
