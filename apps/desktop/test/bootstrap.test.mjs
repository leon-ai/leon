import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { create } from 'tar'

const temporary = await mkdtemp(path.join(os.tmpdir(), 'leon-desktop-bootstrap-'))
process.env.LEON_HOME = path.join(temporary, 'home')
process.env.LEON_PROFILE = 'desktop-test'
await mkdir(process.env.LEON_HOME)
const { createBootstrap, coreReady } = await import('../.generated/src/bootstrap.js')
const { createProgressStore, SetupPhase } = await import('../.generated/src/progress.js')
const { controlCore, createCoreService, serviceDefinition, stopCoreAndWait } = await import('../.generated/src/service.js')
const { runCommand } = await import('../.generated/src/process.js')
const { activateRuntime, currentRuntime, FileDownloader, getProfilePaths, runtimePlatform } = await import('../.generated/runtime/bootstrap-runtime.mjs')
const { default: contract } = await import('../.generated/runtime/bootstrap-contract.mjs')
const { DESKTOP_CORE_PROTOCOL_VERSION } = await import('../../../bridges/runtime/contracts/distribution.js')
const { CORE_READY_EVENT } = await import('../../../bridges/runtime/contracts/update-status.js')
const root = fileURLToPath(new URL('../', import.meta.url))
after(async () => {
  await rm(temporary, { recursive: true, force: true })
})

async function until(probe, label) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const value = await probe()
    if (value) {
      return value
    }
    await delay(25)
  }
  throw new Error(`Timed out: ${label}`)
}

async function httpServer(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, async close() {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  } }
}

async function withManagedProfile(run) {
  const home = process.env.LEON_HOME
  const profile = process.env.LEON_PROFILE
  const config = getProfilePaths().config
  const previousCodebase = process.env.LEON_CODEBASE_PATH
  const gate = await httpServer((_request, response) => response.end())
  const port = Number(new URL(gate.origin).port)

  await gate.close()
  await mkdir(path.dirname(config), { recursive: true })
  await writeFile(config, `server:\n  port: ${port}\n`)
  delete process.env.LEON_CODEBASE_PATH

  try {
    await run({ home, profile, port, origin: gate.origin })
  } finally {
    const service = await readFile(path.join(home, 'desktop/service/core.json'), 'utf8').then(JSON.parse).catch(() => null)
    if (service) {
      await stopCoreAndWait(service)
    }
    await rm(path.join(home, 'desktop'), { recursive: true, force: true })
    await rm(config, { force: true })
    if (previousCodebase !== undefined) {
      process.env.LEON_CODEBASE_PATH = previousCodebase
    }
  }
}

async function writeFiles(directory, files) {
  for (const [name, content] of Object.entries(files)) {
    const filename = path.join(directory, name)

    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, content)
  }
}

function coreEntry(port, version, start = '') {
  return `import { createServer } from 'node:http'
${start}
createServer((_request, response) => response.end(JSON.stringify({ authenticated: false, profile_name: null,
  version: ${JSON.stringify(version)}, desktop_protocol_version: ${DESKTOP_CORE_PROTOCOL_VERSION} }))).listen(${port}, '127.0.0.1', () => {
  process.send?.({ kind: ${JSON.stringify(CORE_READY_EVENT)}, version: ${JSON.stringify(version)} })
})\n`
}

async function coreVersion(origin) {
  return fetch(new URL('/api/v1/profile-auth', origin)).then((response) => response.json()).then((value) => value.version).catch(() => null)
}

test('setup details stay bounded and redact inherited and profile secrets', async () => {
  const store = createProgressStore({ LEON_API_KEY: 'private-environment-value' })
  store.addSecrets({ PROVIDER_SECRET: 'private-profile-value' })
  store.step('setup', 'Install')
  for (let index = 0; index < 200; index += 1) {
    store.detail('setup', `${index} private-environment-value private-profile-value ${'a'.repeat(10_000)}`)
  }
  assert.equal(store.state.steps[0].details.length, 100)
  const serialized = JSON.stringify(store.state)
  assert.ok(serialized.length < 220_000)
  assert.ok(!serialized.includes('private-environment-value'))
  assert.ok(!serialized.includes('private-profile-value'))
  store.close()
})

test('cancelling setup terminates an owned command and releases output pipes', async () => {
  const controller = new AbortController()
  const running = runCommand(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], {
    signal: controller.signal, onLine: () => controller.abort(new Error('cancelled-by-owner'))
  })
  await assert.rejects(running, /cancelled-by-owner/)
})

test('readiness accepts Core authentication without hardware or session requests', async () => {
  const requests = []
  const server = await httpServer((request, response) => {
    requests.push(request.url)
    response.end(JSON.stringify({ success: true, status: 200, authenticated: false, profile_name: null,
      version: contract.sourceVersion, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION }))
  })
  try {
    assert.equal(await coreReady(server.origin), true)
    assert.deepEqual(requests, ['/api/v1/profile-auth'])
  } finally {
    await server.close()
  }
})

test('a compatible running external Core is connected without executing setup', async () => {
  const controller = await createBootstrap({ dependencies: {
    probe: async () => true, command: async () => {
 throw new Error('Existing Core must not run setup') 
}
  } })
  try {
    await controller.start()
    assert.equal(controller.store.state.phase, SetupPhase.Complete)
    assert.equal(controller.store.state.external, true)
    assert.match(controller.store.state.server, /^http:\/\/127.0.0.1:/)
    await assert.rejects(controller.setStartup(true), /managed local instance/)
    await assert.rejects(controller.stop(), /only the Core/)
  } finally {
    await controller.close()
  }
})

test('a responding incompatible Core is rejected rather than treated as an offline server', async () => {
  const server = await httpServer((_request, response) => {
    response.end(JSON.stringify({ authenticated: false, profile_name: null,
      version: contract.sourceVersion, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION + 1 }))
  })
  try {
    await assert.rejects(coreReady(server.origin), /compatible Leon Core/)
    const controller = await createBootstrap({ origin: server.origin, dependencies: {
      command: async () => {
        throw new Error('An incompatible server must never start setup')
      }
    } })
    try {
      await controller.start()
      assert.equal(controller.store.state.phase, SetupPhase.Failed)
      assert.match(controller.store.state.error, /compatible Leon Core/)
    } finally {
      await controller.close()
    }
  } finally {
    await server.close()
  }
})

test('startup reuses a supported running Core and restarts an incompatible managed checkout into its built Core', async () => {
  await withManagedProfile(async ({ home, profile, port, origin }) => {
    const codebase = path.join(temporary, 'rebuilt-checkout')
    const older = `${semver.major(contract.minimumVersion)}.0.0-0`
    const entry = path.join(codebase, 'server/dist/index.js')
    await writeFiles(codebase, {
      'package.json': JSON.stringify({ type: 'module', version: contract.sourceVersion }),
      'server/dist/index.js': coreEntry(port, contract.minimumVersion),
      'server/dist/pre-check.js': '',
      'apps/web/dist/index.html': '',
      'scripts/run-with-managed-node.js': 'await import(new URL(\'../\' + process.argv[2], import.meta.url))\n'
    })
    let service = await createCoreService({ home, codebase, node: process.execPath, profile })
    await service.start()
    await until(() => coreVersion(origin), 'supported Core readiness')
    const running = await controlCore(service.configuration)
    const compatible = await createBootstrap()
    try {
      await compatible.start()
      assert.equal(compatible.store.state.phase, SetupPhase.Complete, compatible.store.state.error)
      assert.equal(compatible.store.state.external, false)
      assert.equal((await controlCore(service.configuration)).pid, running.pid)
      assert.equal(await compatible.deviceOwnerCredential(origin), undefined)
      const credentialFile = getProfilePaths(profile).dotEnv
      await writeFile(credentialFile, 'LEON_PROFILE_TOKEN=device-pairing-fixture\n')
      try {
        assert.equal(await compatible.deviceOwnerCredential(origin), profile + ':device-pairing-fixture')
        assert.equal(await compatible.deviceOwnerCredential('https://another-core.example'), undefined)
      } finally {
        await rm(credentialFile)
      }
    } finally {
      await compatible.close()
    }

    await stopCoreAndWait(service.configuration)
    await writeFile(entry, coreEntry(port, older))
    service = await createCoreService({ home, codebase, node: process.execPath, profile })
    await service.start()
    assert.equal(await until(() => coreVersion(origin), 'older Core readiness'), older)
    const oldRunner = await controlCore(service.configuration)
    await writeFile(entry, coreEntry(port, contract.sourceVersion))

    const external = await createBootstrap({ origin })
    try {
      await external.start()
      assert.equal(external.store.state.phase, SetupPhase.Failed)
      assert.equal((await controlCore(service.configuration)).pid, oldRunner.pid)
      assert.equal(await coreVersion(origin), older)
    } finally {
      await external.close()
    }

    const recovering = await createBootstrap()
    try {
      await recovering.start()
      assert.equal(recovering.store.state.phase, SetupPhase.Complete, recovering.store.state.error)
      assert.notEqual((await controlCore(service.configuration)).pid, oldRunner.pid)
      assert.equal(await coreVersion(origin), contract.sourceVersion)
    } finally {
      await recovering.close()
    }
  })
})

test('a failed managed runtime upgrade restores the running previous Core and can be retried', async () => {
  await withManagedProfile(async ({ home, profile, port, origin }) => {
    const installation = path.join(home, 'runtimes/core')
    const previous = `${semver.major(contract.minimumVersion)}.0.0-0`
    const version = contract.sourceVersion
    const platform = runtimePlatform()
    const previousRoot = path.join(installation, 'versions', previous)
    const payload = path.join(temporary, 'next-runtime')
    const blocked = path.join(temporary, 'candidate-unavailable')
    const runtimeLauncher = new URL('../../../scripts/run-runtime.js', import.meta.url).href
    const node = process.platform === 'win32' ? 'runtime/node/node.exe' : 'runtime/node/bin/node'
    const pnpm = process.platform === 'win32' ? 'runtime/pnpm/pnpm.exe' : 'runtime/pnpm/pnpm'
    for (const [directory, release] of [[previousRoot, previous], [payload, version]]) {
      const start = directory === payload
        ? `import { existsSync } from 'node:fs'\nif (existsSync(${JSON.stringify(blocked)})) { process.exit(1) }`
        : ''
      await writeFiles(directory, {
        'package.json': JSON.stringify({ type: 'module', version: release }),
        'leon-runtime.json': JSON.stringify({ schemaVersion: 1, version: release, platform,
          desktopProtocolVersion: DESKTOP_CORE_PROTOCOL_VERSION, links: [] }),
        'scripts/run-with-managed-node.js': `import { runRuntime } from ${JSON.stringify(runtimeLauncher)}\nawait runRuntime(process.env.LEON_RUNTIME_HOME)\n`,
        'server/dist/index.js': coreEntry(port, release, start),
        'server/dist/pre-check.js': '',
        'server/dist/distribution-setup.js': '',
        'apps/web/dist/index.html': '',
        [pnpm]: ''
      })
      const binary = path.join(directory, node)
      await mkdir(path.dirname(binary), { recursive: true })
      await copyFile(process.execPath, binary)
    }
    await writeFile(blocked, '')
    await activateRuntime(installation, previous)
    const service = await createCoreService({ home, profile, runtimeHome: installation, codebase: previousRoot,
      node: path.join(previousRoot, node), pnpm: path.join(previousRoot, pnpm) })
    await service.start()
    assert.equal(await until(() => coreVersion(origin), 'previous runtime readiness'), previous)

    const name = `leon-core-${version}-${platform}.tar.gz`
    const archive = path.join(temporary, name)
    await create({ file: archive, cwd: payload, gzip: true, portable: true }, ['package.json', 'leon-runtime.json', 'scripts', 'server', 'apps', 'runtime'])
    const bytes = await readFile(archive)
    const servingDuringDownload = []
    const assets = await httpServer(async (request, response) => {
      servingDuringDownload.push(await coreVersion(origin))
      response.writeHead(200, { 'content-length': bytes.length })
      response.end(request.method === 'HEAD' ? undefined : bytes)
    })
    const asset = { name, version, platform, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      url: new URL(name, assets.origin).href }
    const controller = await createBootstrap({ dependencies: { asset: async () => asset } })
    try {
      await controller.start()
      assert.equal(controller.store.state.phase, SetupPhase.Failed)
      assert.match(controller.store.state.error, /runtime did not finish startup/)
      assert.equal((await currentRuntime(installation)).manifest.version, previous)
      assert.equal(await until(() => coreVersion(origin), 'restored runtime readiness'), previous)
      assert.ok(servingDuringDownload.length > 0)
      assert.ok(servingDuringDownload.every((release) => release === previous))

      await rm(blocked)
      await controller.start()
      assert.equal(controller.store.state.phase, SetupPhase.Complete, controller.store.state.error)
      assert.equal((await currentRuntime(installation)).manifest.version, version)
      assert.equal(await coreVersion(origin), version)
    } finally {
      await controller.close()
      await assets.close()
    }
  })
})

test('a managed Core survives its desktop owner and is reused without a second process', async () => {
  const home = path.join(temporary, 'service-home')
  const codebase = path.join(temporary, 'fixture-checkout')
  const marker = path.join(temporary, 'server-starts')
  const gate = await httpServer((_request, response) => response.end())
  const port = Number(new URL(gate.origin).port)
  await gate.close()
  await mkdir(path.join(codebase, 'scripts'), { recursive: true })
  await mkdir(path.join(codebase, 'server/dist'), { recursive: true })
  await mkdir(home)
  // Exercise a real detached Node process with the same launcher invocation contract.
  await writeFile(path.join(codebase, 'scripts/run-with-managed-node.js'), `import { spawn } from 'node:child_process'
const child = spawn(process.execPath, process.argv.slice(2), { stdio: 'inherit' })
process.on('SIGTERM', () => child.kill('SIGTERM'))
child.on('exit', (code) => process.exit(code ?? 0))\n`)
  await writeFile(path.join(codebase, 'package.json'), '{"type":"module"}')
  await writeFile(path.join(codebase, 'server/dist/pre-check.js'), '')
  await writeFile(path.join(codebase, 'server/dist/index.js'), `import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(marker)}, 'started\\n')
if (process.platform === 'linux') {
  appendFileSync(${JSON.stringify(marker)}, JSON.stringify({
    display: process.env.WAYLAND_DISPLAY, desktop: process.env.XDG_CURRENT_DESKTOP,
    unrelated: process.env.LEON_FIXTURE_PRIVATE_VALUE ?? null
  }) + '\\n')
}
createServer((_request, response) => response.end(JSON.stringify({ authenticated: false, profile_name: null, version: '${contract.sourceVersion}', desktop_protocol_version: ${DESKTOP_CORE_PROTOCOL_VERSION} }))).listen(${port}, '127.0.0.1')\n`)
  const service = await createCoreService({ home, codebase, node: process.execPath, pnpm: process.execPath,
    profile: 'fixture' })
  try {
    await runCommand(process.execPath, ['--input-type=module', '-e', `
      const { createCoreService } = await import(${JSON.stringify(new URL('../.generated/src/service.js', import.meta.url).href)});
      const service = await createCoreService({
        ...${JSON.stringify({ home, codebase, node: process.execPath, pnpm: process.execPath, profile: 'fixture' })},
        environment: { ...process.env, WAYLAND_DISPLAY: 'wayland-fixture',
          XDG_CURRENT_DESKTOP: 'GNOME', LEON_FIXTURE_PRIVATE_VALUE: 'excluded' }
      });
      await service.start();
    `])
    assert.ok(await until(() => coreReady(`http://127.0.0.1:${port}`), 'detached Core readiness'))
    const first = await controlCore(service.configuration)
    assert.ok(first?.pid)
    const reopened = await createCoreService({ home, codebase: codebase + path.sep + 'server' + path.sep + '..', node: process.execPath,
      pnpm: process.execPath, profile: 'fixture' })
    await reopened.start()
    assert.equal((await controlCore(reopened.configuration)).pid, first.pid)
    const output = (await readFile(marker, 'utf8')).trimEnd().split('\n')
    assert.equal(output[0], 'started')
    if (process.platform === 'linux') {
      assert.deepEqual(JSON.parse(output[1]), {
        display: 'wayland-fixture', desktop: 'GNOME', unrelated: null
      })
    }
    // Authenticating a control connection must not grant another local client access.
    assert.equal(await controlCore({ ...service.configuration, controlToken: 'wrong-token' }, 'stop'), null)
    assert.equal(await coreReady(`http://127.0.0.1:${port}`), true)
  } finally {
    await controlCore(service.configuration, 'stop')
    await until(async () => !await controlCore(service.configuration), 'Core stop')
    await until(async () => !await coreReady(`http://127.0.0.1:${port}`), 'Core child stop')
  }
})

test('startup definitions preserve paths with spaces and platform-specific escaping', async () => {
  const input = { id: 'ai.getleon.test', node: '/Users/Owner & Co/Node/node', runner: '/data/Leon\'s Core/runner.mjs',
    configurationPath: '/data/100% $safe/core.json', directory: '/data/100% $safe', log: '/data/log',
    home: '/Users/Owner & Co', username: 'DOMAIN\\Owner', uid: 501, windowsRoot: 'D:\\Windows' }
  const mac = serviceDefinition({ ...input, platform: 'darwin' })
  assert.ok(mac.content.includes('Owner &amp; Co'))
  assert.ok(mac.content.includes('Leon&apos;s Core'))
  const linux = serviceDefinition({ ...input, platform: 'linux' })
  assert.ok(linux.content.includes('100%% $$safe'))
  const windows = serviceDefinition({ ...input, platform: 'win32' })
  assert.ok(windows.content.includes('D:\\Windows\\System32\\conhost.exe'))
  assert.ok(windows.content.includes('--headless'))
  // Validate XML locally without installing a login item on the owner's machine.
  if (process.platform === 'darwin') {
    const file = path.join(temporary, 'service.plist')
    await writeFile(file, mac.content)
    await runCommand('plutil', ['-lint', file])
  }
})

// The copied downloader must remain usable without Core/SDK/bridge packages.
test('bootstrap runtime imports only Node built-ins after bundling', async () => {
  const destination = path.join(temporary, 'isolated-runtime.mjs')
  await writeFile(destination, await readFile(path.join(root, '.generated/runtime/bootstrap-runtime.mjs')))
  await runCommand(process.execPath, ['--input-type=module', '-e',
    `const runtime = await import(${JSON.stringify(new URL(`file://${destination}`).href)}); if (!runtime.FileDownloader || !runtime.getProfilePaths) process.exit(1)`],
  { cwd: temporary, env: { ...process.env, LEON_HOME: path.join(temporary, 'isolated-home') } })
  assert.equal(typeof FileDownloader.downloadFile, 'function')
})
