import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { LEON_HOME_PATH, LEON_PROFILE_NAME, getProfilePaths, YAML, dotenv,
  FileDownloader, readRuntimeMetadata, installRuntimeArchive,
  currentRuntime, activateRuntime, runtimeEnvironment, acquireRuntimeLock, getUpdateStatePath,
  semver, writeRuntimeJSON, UPDATE_STAGE_LABELS } from '../runtime/bootstrap-runtime.mjs'
import contract from '../runtime/bootstrap-contract.mjs'
import { createProgressStore, SetupPhase, type ProgressStore } from './progress.js'
import { runCommand } from './process.js'
import { controlCore, createCoreService, stopCoreAndWait, type CoreService } from './service.js'
import { assertCoreCompatibility, CoreCompatibilityError, findCoreAsset, supportsCore, type PublishedRuntime } from './compatibility.js'
import { DESKTOP_CORE_PROTOCOL_VERSION } from '../../../bridges/runtime/contracts/desktop-client'
import type { CoreRuntime, RuntimeAsset } from '../runtime/bootstrap-runtime.mjs'
import type { DesktopDeviceRuntime, HostError, ServiceConfiguration } from './types.js'
import { UpdatePhase, type RuntimeUpdateJob, type UpdateState, type UpdateJob } from '../../../bridges/runtime/contracts/updates'

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
  deviceRuntime: (signal: AbortSignal) => Promise<DesktopDeviceRuntime>
  deviceOwnerCredential: (backend: string) => Promise<string | undefined>
  readonly log: string | undefined
  close: () => Promise<void>
}

const STARTUP_TIMEOUT_MS = 120_000
const READY_INTERVAL_MS = 500
const MAXIMUM_READINESS_BYTES = 16_384

/**
 * Reads the shared receipt used by the detached server supervisor.
 */
async function readUpdateJob(statePath: string): Promise<UpdateJob | null> {
  return readFile(statePath, 'utf8').then(JSON.parse).catch((error) => {
    if ((error as HostError).code === 'ENOENT') {
      return null
    }
    throw error
  })
}

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
 * Resolves the same profile port for the gateway and its managed server process.
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
 * Installs built server releases into a shared version store, independent of the
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
  const lockPath = path.join(directory, 'install.lock')
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
  const createService = dependencies.service ?? createCoreService
  const persist = (): Promise<void> => writeFile(settingsPath, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 })
  let operation: AbortController | undefined
  let pending: Promise<void> | undefined
  let service: CoreService | undefined
  let server: string | undefined
  let activeRuntime: CoreRuntime | null = null

  async function step<T>(id: string, label: string, execute: () => Promise<T>): Promise<T> {
    const signal = operation!.signal

    signal.throwIfAborted()
    store.step(id, label, { phase: SetupPhase.Running, value: null, total: null })
    const result = await execute()
    signal.throwIfAborted()
    store.step(id, label, { phase: SetupPhase.Complete })
    return result
  }

  async function releaseAsset(signal: AbortSignal): Promise<RuntimeAsset> {
    const repository = new URL(contract.repository).pathname.slice(1)
    const releases = await readRuntimeMetadata(`https://api.github.com/repos/${repository}/releases?per_page=100`, { signal }) as PublishedRuntime[]
    return findCoreAsset(releases, (url) => readRuntimeMetadata(url, { signal }))
  }

  async function runningConfiguration(): Promise<ServiceConfiguration | undefined> {
    if (origin) {
      return undefined
    }

    const config: ServiceConfiguration | null = await readFile(path.join(directory, 'service/core.json'), 'utf8').then(JSON.parse).catch(() => null)
    if (config && (await controlCore(config))?.running) {
      return config
    }

    return undefined
  }

  async function downloadRuntime(asset: RuntimeAsset, signal: AbortSignal): Promise<CoreRuntime> {
    let installationStage: 'download' | 'verifying' | 'extracting' = 'download'
    const runtime = await step('download', 'Downloading and verifying my server', () => installRuntimeArchive({
      installation, asset, signal, download: FileDownloader.downloadFile.bind(FileDownloader),
      onStage: (stage) => {
        if (stage !== 'downloading') {
          store.step(installationStage, installationStage === 'download' ? 'Downloading my server' : UPDATE_STAGE_LABELS[installationStage], { phase: SetupPhase.Complete })
          installationStage = stage
          store.step(stage, UPDATE_STAGE_LABELS[stage], { phase: SetupPhase.Running, value: null, total: null })
        }
      },
      onProgress: (value) => store.step('download', 'Downloading my server', {
        value: value.downloadedBytes, total: value.totalBytes, sublabel: asset.name })
    }))

    // Verify the extracted release before changing any profile or active runtime.
    assertCoreCompatibility({ version: runtime.manifest.version,
      desktop_protocol_version: runtime.manifest.desktopProtocolVersion })
    store.step(installationStage, installationStage === 'download' ? 'Downloading my server' : UPDATE_STAGE_LABELS[installationStage], { phase: SetupPhase.Complete })
    return runtime
  }

  async function prepareRuntime(runtime: CoreRuntime, signal: AbortSignal): Promise<void> {
    await step('prepare', 'Preparing my profiles', () => command(runtime.node, [runtime.setup], {
      cwd: runtime.root, env: { ...runtimeEnvironment(runtime, installation), LEON_PROFILE: LEON_PROFILE_NAME, LEON_SETUP_PROGRESS: 'json' },
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
  }

  async function run(): Promise<void> {
    const signal = operation!.signal
    let lock: (() => Promise<void>) | undefined
    let updateLock: (() => Promise<void>) | undefined
    let started = false
    let stopped: ServiceConfiguration | undefined
    let recovery: { statePath: string, job: RuntimeUpdateJob } | undefined
    const stopManaged = async (config: ServiceConfiguration): Promise<void> => {
      await step('restart', 'Restarting my server', async () => {
        await stopCoreAndWait(config)
        stopped = config
      })
    }

    try {
      // The application lock serializes UI launches; this also protects installers.
      lock = await acquireRuntimeLock(lockPath)
      store.update({ phase: SetupPhase.Running, steps: [], error: null })
      server = origin ?? await profileOrigin()
      let mismatch: CoreCompatibilityError | undefined
      const ready = await step('instance', 'Checking my local instance', async () => {
        try {
          return await probe(server, signal)
        } catch (error) {
          if (!(error instanceof CoreCompatibilityError)) {
            throw error
          }
          mismatch = error
          return false
        }
      })
      const running = await runningConfiguration()
      const runningHome = running?.environment?.['LEON_HOME']
      const managed = (!origin || new URL(origin).origin === new URL(await profileOrigin()).origin) &&
        running?.environment?.['LEON_PROFILE'] === LEON_PROFILE_NAME && runningHome &&
        await realpath(runningHome).catch(() => null) === await realpath(home) ? running : undefined
      if (ready) {
        service = managed ? await createService({ ...managed, home, profile: LEON_PROFILE_NAME }) : undefined
        store.update({ phase: SetupPhase.Complete, external: !service, server })
        return
      }
      if (mismatch && (!managed || !mismatch.coreVersion)) {
        throw mismatch
      }
      if (running && !managed) {
        throw new Error('Another managed server is using this Leon home.')
      }
      if (origin) {
        throw new Error('I could not reach the selected server. Start it, then retry connecting.')
      }
      let codebase: string
      let node: string
      let pnpm: string
      let runtimeHome: string | undefined
      const sourcePath = process.env['LEON_CODEBASE_PATH'] || (!saved.runtimeHome ? saved.codebase : null) ||
        (managed && !managed.runtimeHome ? managed.codebase : undefined)
      if (sourcePath) {
        codebase = await realpath(sourcePath)
        if (managed && (managed.runtimeHome || await realpath(managed.codebase) !== codebase)) {
          throw mismatch ?? new Error('Another managed installation is using this Leon home.')
        }
        node = managed?.node ?? path.join(home, 'bin/node', process.platform === 'win32' ? 'node.exe' : 'bin/node')
        pnpm = managed?.pnpm ?? path.join(home, 'bin/pnpm', process.platform === 'win32' ? 'pnpm.exe' : 'pnpm')
        await step('source', 'Checking my existing installation', async () => {
          const source = JSON.parse(await readFile(path.join(codebase, 'package.json'), 'utf8'))
          // The running endpoint also verifies the actual compiled protocol.
          assertCoreCompatibility({ version: source.version, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION })
          if (mismatch?.coreVersion && semver.gt(mismatch.coreVersion, source.version)) {
            throw mismatch
          }
          const required = ['server/dist/index.js', 'apps/web/dist/index.html', 'scripts/run-with-managed-node.js']
            .map((file) => path.join(codebase, file))
          if (mismatch) {
            required.push(path.join(codebase, 'server/dist/pre-check.js'), node)
          }
          const files = await Promise.all(required.map((file) => stat(file)))
          if (files.some((file) => !file.isFile())) {
            throw new Error('I need a complete server build before I can start this checkout.')
          }
        })
        if (mismatch && managed) {
          await stopManaged(managed)
        }
      } else {
        if (managed && (!managed.runtimeHome || await realpath(managed.runtimeHome) !== await realpath(installation))) {
          throw mismatch ?? new Error('Another managed installation is using this Leon home.')
        }
        let selected = await currentRuntime(installation).catch((error) => {
          if ((error as HostError).code === 'ENOENT') {
            return null
          }
          throw error
        })
        const previous = selected
        if (!selected || !supportsCore({ version: selected.manifest.version,
          desktop_protocol_version: selected.manifest.desktopProtocolVersion })) {
          const asset = await step('release', 'Finding my server release', () => (dependencies.asset ?? releaseAsset)(signal))
          if (previous && !semver.gt(asset.version, previous.manifest.version)) {
            throw mismatch ?? new Error('I need a Desktop version that supports my installed server.')
          }
          if (mismatch?.coreVersion && semver.gt(mismatch.coreVersion, asset.version)) {
            throw mismatch
          }
          selected = await downloadRuntime(asset, signal)
          if (previous) {
            const statePath = getUpdateStatePath(home, installation, installation)
            await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 })
            updateLock = await acquireRuntimeLock(`${statePath}.lock`)
            const existing = await readUpdateJob(statePath)
            if (existing && [UpdatePhase.Scheduled, UpdatePhase.Installing, UpdatePhase.Restarting].some((phase) => phase === existing.phase)) {
              // A stopped supervisor cannot still be applying an update under
              // this lock. Its previous selection can be reused for this attempt.
              if (managed || !('kind' in existing) || existing.expectedVersion !== previous.manifest.version) {
                throw new Error('My server installation is already changing. Retry when it finishes.')
              }
            }
            if ((await currentRuntime(installation)).manifest.version !== previous.manifest.version) {
              throw new Error('My server installation is already changing. Retry when it finishes.')
            }
            if (managed) {
              await stopManaged(managed)
            }
            // The detached supervisor can restore the previous version even
            // if Desktop exits before the candidate finishes starting.
            const job: RuntimeUpdateJob = { id: randomUUID(), kind: 'runtime', phase: UpdatePhase.Installing,
              version: asset.version, error: null, root: previous.root, installation,
              expectedVersion: previous.manifest.version, asset, profile: LEON_PROFILE_NAME }
            await writeRuntimeJSON(statePath, job)
            recovery = { statePath, job }
          }
          await prepareRuntime(selected, signal)
          await activateRuntime(installation, selected.manifest.version)
          if (recovery) {
            recovery.job.phase = UpdatePhase.Restarting
            await writeRuntimeJSON(recovery.statePath, recovery.job)
          }
        } else if (mismatch && managed) {
          if (mismatch.coreVersion && semver.gt(mismatch.coreVersion, selected.manifest.version)) {
            throw mismatch
          }
          await stopManaged(managed)
        }
        activeRuntime = selected
        codebase = selected.root
        node = selected.node
        pnpm = selected.pnpm
        runtimeHome = installation
      }
      service = await createService({ home, codebase, node, pnpm, runtimeHome, profile: LEON_PROFILE_NAME })
      started = !await controlCore(service.configuration)
      await step('start', 'Starting my server', () => service!.start())
      store.update({ logAvailable: true })
      server = await profileOrigin()
      await step('ready', 'Waiting for my server', async () => {
        const deadline = Date.now() + STARTUP_TIMEOUT_MS
        while (true) {
          const update = recovery && await readUpdateJob(recovery.statePath)
          if (update?.id === recovery?.job.id && update?.phase === UpdatePhase.Failed) {
            throw new Error(update.error ?? 'My new server could not start.')
          }
          if (await probe(server, signal) &&
            (!recovery || update?.id === recovery.job.id && update.phase === UpdatePhase.Completed)) {
            return
          }
          if (Date.now() > deadline) {
            throw new Error('My server did not become ready. Open server logs, then retry.')
          }
          await delay(READY_INTERVAL_MS, undefined, { signal })
        }
      })
      Object.assign(saved, { codebase, runtimeHome })
      await persist()
      store.update({ phase: SetupPhase.Complete, external: false, server, installation: codebase })
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error)
      try {
        if (recovery) {
          const { job, statePath } = recovery
          if ((await currentRuntime(installation)).manifest.version !== job.expectedVersion) {
            if (service && job.phase === UpdatePhase.Restarting) {
              await stopCoreAndWait(service.configuration)
            }
            await activateRuntime(installation, job.expectedVersion)
          }
          await writeRuntimeJSON(statePath, { ...job, phase: UpdatePhase.Failed, error: store.redact(message) })
          activeRuntime = null
        } else if (signal.aborted && started && service && !stopped) {
          await controlCore(service.configuration, 'stop')
        }
        if (stopped && (recovery || !started)) {
          service = await createService({ ...stopped, home, profile: LEON_PROFILE_NAME })
          await service.start()
        }
      } catch (restoreError) {
        message = `I could not restore my previous server. ${store.redact(restoreError)} (${message})`
      }
      for (const item of store.state.steps) {
        if (item.phase === SetupPhase.Running) {
          store.step(item.id, item.label, { phase: signal.aborted ? SetupPhase.Cancelled : SetupPhase.Failed })
        }
      }
      store.update({ phase: signal.aborted ? SetupPhase.Cancelled : SetupPhase.Failed, error: store.redact(message) })
    } finally {
      await updateLock?.()
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
        throw new Error('I can stop only the server started by this desktop installation')
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
      const job = await readUpdateJob(getUpdateStatePath(home, config.codebase, config.runtimeHome))
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
        // full dependency manifest once when the server activates another version.
        if (activeRuntime?.manifest.version !== selection.version) {
          activeRuntime = await currentRuntime(runtimeHome)
          assertCoreCompatibility({ version: activeRuntime.manifest.version,
            desktop_protocol_version: activeRuntime.manifest.desktopProtocolVersion })
        }
        return activeRuntime!.frontend
      }
      return service ? path.join(service.configuration.codebase, 'apps/web/dist') : undefined
    },
    async deviceRuntime(signal): Promise<DesktopDeviceRuntime> {
      const config = service?.configuration
      const checkout = process.env['LEON_CODEBASE_PATH'] || (config && !config.runtimeHome ? config.codebase : undefined)
      const environment = { LEON_HOME: home, LEON_PROFILE: LEON_PROFILE_NAME }
      if (checkout) {
        const root = await realpath(checkout)
        const node = config?.node ?? path.join(home, 'bin/node', process.platform === 'win32' ? 'node.exe' : 'bin/node')

        await stat(path.join(root, 'server/dist/satellite.js'))
        return { node, root, environment: { ...environment, LEON_CODEBASE_PATH: root } }
      }

      const runtimeHome = config?.runtimeHome ?? installation
      const unlock = await acquireRuntimeLock(lockPath)
      try {
        let runtime = await currentRuntime(runtimeHome).catch((error: HostError) => {
          if (error.code !== 'ENOENT') {
            throw error
          }
          return null
        })
        if (!runtime) {
          const asset = await (dependencies.asset ?? releaseAsset)(signal)
          runtime = await installRuntimeArchive({
            installation: runtimeHome, asset, signal, download: FileDownloader.downloadFile.bind(FileDownloader)
          })
          const prepared = { ...runtimeEnvironment(runtime, runtimeHome), ...environment }
          await command(runtime.node, [runtime.setup], { cwd: runtime.root, env: prepared, signal })
          await activateRuntime(runtimeHome, runtime.manifest.version)
        }

        assertCoreCompatibility({ version: runtime.manifest.version,
          desktop_protocol_version: runtime.manifest.desktopProtocolVersion })
        return { node: runtime.node, root: runtime.root,
          environment: { ...runtimeEnvironment(runtime, runtimeHome), ...environment } }
      } finally {
        unlock()
      }
    },
    async deviceOwnerCredential(backend): Promise<string | undefined> {
      // A locally managed server may allow anonymous chat. Pairing still proves
      // ownership using the credential from this launcher's own local profile.
      if (!service || store.state.external || !server ||
          new URL(server).origin !== new URL(backend).origin) {
        return undefined
      }
      const profile = service.configuration.environment['LEON_PROFILE']
      if (!profile) {
        return undefined
      }
      const token = await readFile(getProfilePaths(profile).dotEnv, 'utf8')
        .then((content) => dotenv.parse(content)['LEON_PROFILE_TOKEN'])
        .catch((error: HostError) => {
          if (error.code !== 'ENOENT') {
            throw error
          }
          return undefined
        })

      return token ? profile + ':' + token : undefined
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
