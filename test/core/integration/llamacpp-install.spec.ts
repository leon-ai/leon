import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createZipArchive, extractZipArchive } from '@sdk/utils/archive'

const fixture = await vi.hoisted(async () => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')

  return {
    root: await fs.mkdtemp(path.join(os.tmpdir(), 'leon-llamacpp-install-')),
    platform: 'win32', endpoint: '', devices: true, fitterDevices: true,
    runtimeStatus: 200, downloads: [] as string[], succeed: vi.fn(), warning: vi.fn()
  }
})

vi.mock('@/constants', async (load) => ({
  ...await load<typeof import('@/constants')>(),
  LLAMACPP_RELEASE_VERSION: 'fixture-release',
  LLAMACPP_PATH: path.join(fixture.root, 'runtime'),
  LLAMACPP_BUILD_PATH: path.join(fixture.root, 'runtime', 'build'),
  LLAMACPP_BUILD_MANIFEST_PATH: path.join(fixture.root, 'runtime', 'build', 'manifest.json'),
  LLAMACPP_ROOT_MANIFEST_PATH: path.join(fixture.root, 'runtime', 'manifest.json'),
  LLAMACPP_SOURCE_PATH: path.join(fixture.root, 'runtime', 'source'),
  LLAMACPP_SOURCE_BUILD_PATH: path.join(fixture.root, 'runtime', 'source', 'build', 'bin'),
  LLAMACPP_SOURCE_MANIFEST_PATH: path.join(fixture.root, 'runtime', 'source', 'manifest.json')
}))
vi.mock('@/helpers/system-helper', () => ({ SystemHelper: {
  getInformation: (): object => ({ cpuArchitecture: 'x64', type: fixture.platform }),
  isWindows: (): boolean => fixture.platform === 'win32',
  isLinux: (): boolean => fixture.platform === 'linux',
  isMacOS: (): boolean => fixture.platform === 'darwin'
} }))
vi.mock('@/helpers/file-helper', async (load) => {
  const { FileHelper } = await load<typeof import('@/helpers/file-helper')>()

  return { FileHelper: {
    createManifestFile: FileHelper.createManifestFile,
    // Exercise real downloads and ZIP contents through a local release server.
    downloadFile: async (url: string, destination: string): Promise<void> => {
      fixture.downloads.push(url)
      await FileHelper.downloadFile(`${fixture.endpoint}/${path.basename(url)}`, destination, {
        cliProgress: false, retry: { retries: 0 }, retryFetchDownloadInfo: { retries: 0 }
      })
    },
    extractArchive: extractZipArchive
  } }
})
vi.mock('execa', async (load) => {
  const { execa } = await load<typeof import('execa')>()

  return {
    // Portable subprocess fixtures stand in for platform-specific native binaries.
    execa: (binary: string, args: string[], options: object): ReturnType<typeof execa> =>
      execa(process.execPath, [binary, ...args], {
        ...options,
        env: {
          LEON_TEST_LLAMA_DEVICES: String(fixture.devices),
          LEON_TEST_LLAMA_FITTER_DEVICES: String(fixture.fitterDevices)
        }
      })
  }
})
vi.mock('@@/scripts/setup/setup-status', () => ({
  createSetupStatus: (): object => {
    const status = { text: '', isSpinning: false, succeed: fixture.succeed,
      start: (): object => status, pause: (): object => status }

    return status
  }
}))
vi.mock('@@/scripts/setup/setup-ui', () => ({ SetupUI: { warning: fixture.warning } }))

const CUDA_DLLS = ['cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll']
const GPU = { hasGPU: true, graphicsComputeAPI: 'cuda' }
const runtimeRoot = path.join(fixture.root, 'runtime')
const buildRoot = path.join(runtimeRoot, 'build')
const manifestPath = path.join(buildRoot, 'manifest.json')
const binaryDirectory = path.join(buildRoot, 'nested', 'bin')
const binarySource = `
const fs = require('node:fs')
const path = require('node:path')
if (process.argv.includes('--version')) {
  console.log('fixture runtime')
} else if (process.argv.includes('--list-devices')) {
  const hasLibraries = !__filename.endsWith('.exe') ||
    ${JSON.stringify(CUDA_DLLS)}.every((name) => fs.existsSync(path.join(__dirname, name)))
  const usable = hasLibraries && process.env.LEON_TEST_LLAMA_DEVICES === 'true' &&
    (!__filename.includes('fit-params') || process.env.LEON_TEST_LLAMA_FITTER_DEVICES === 'true')
  console.error('load_backend: loaded CPU backend; CUDA0: backend candidate')
  console.log('Available devices:')
  console.log(usable ? '  GPU0: Fixture GPU (16384 MiB, 15000 MiB free)' : '  (none)')
} else {
  process.exitCode = 1
}
`
let binaries: Buffer
let libraries: Buffer
const server = createServer((request, response) => {
  if (request.url === '/fixture-release.tar.gz') {
    response.writeHead(404)
    response.end()
    return
  }

  const runtime = request.url?.startsWith('/cudart-')
  const body = runtime ? libraries : binaries
  response.writeHead(runtime ? fixture.runtimeStatus : 200, { 'content-length': body.length })
  response.end(body)
})

/**
 * Create isolated executable fixtures with the same nested layout as a release.
 */
async function writeBinaries(directory: string, suffix: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  for (const name of ['llama-server', 'llama-fit-params']) {
    await fs.writeFile(path.join(directory, `${name}${suffix}`), binarySource)
  }
}

beforeAll(async () => {
  const payloadRoot = path.join(fixture.root, 'payload')
  await writeBinaries(path.join(payloadRoot, 'nested', 'bin'), '.exe')
  await writeBinaries(path.join(payloadRoot, 'nested', 'bin'), '')
  const binaryArchive = path.join(fixture.root, 'binaries.zip')
  await createZipArchive(payloadRoot, binaryArchive)
  binaries = await fs.readFile(binaryArchive)

  const libraryRoot = path.join(fixture.root, 'libraries')
  await fs.mkdir(libraryRoot)
  for (const dll of CUDA_DLLS) {
    await fs.writeFile(path.join(libraryRoot, dll), 'runtime library fixture')
  }
  const libraryArchive = path.join(fixture.root, 'libraries.zip')
  await createZipArchive(libraryRoot, libraryArchive)
  libraries = await fs.readFile(libraryArchive)

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing release fixture address')
  }
  fixture.endpoint = `http://127.0.0.1:${address.port}`
})

beforeEach(async () => {
  vi.resetModules()
  await fs.rm(runtimeRoot, { recursive: true, force: true })
  fixture.platform = 'win32'
  fixture.devices = true
  fixture.fitterDevices = true
  fixture.runtimeStatus = 200
  fixture.downloads = []
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.rm(fixture.root, { recursive: true, force: true })
})

describe('managed llama.cpp installation', () => {
  it('installs matching CUDA libraries beside nested executables before publishing readiness', async () => {
    const { default: setup } = await import('@@/scripts/setup/setup-llama-cpp')
    expect(await setup(GPU)).toBe(true)

    for (const dll of CUDA_DLLS) {
      expect(await fs.readFile(path.join(binaryDirectory, dll), 'utf8')).toBe('runtime library fixture')
    }
    expect(fixture.downloads).toHaveLength(2)
    expect(fixture.downloads.every((url) => new URL(url).pathname.includes('/fixture-release/'))).toBe(true)
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    expect(path.resolve(buildRoot, manifest.runtimePath)).toBe(binaryDirectory)
    expect(await fs.readdir(runtimeRoot)).toEqual(['build'])
  })

  it('repairs a GPU installation that starts without exposing a device and then reuses it', async () => {
    await writeBinaries(binaryDirectory, '.exe')
    await fs.writeFile(manifestPath, JSON.stringify({
      version: 'fixture-release', runtimePath: path.relative(buildRoot, binaryDirectory)
    }))
    const { default: setup } = await import('@@/scripts/setup/setup-llama-cpp')

    expect(await setup(GPU)).toBe(true)
    expect(fixture.warning).toHaveBeenCalled()
    expect(fixture.downloads).toHaveLength(2)
    expect(await setup(GPU)).toBe(true)
    expect(fixture.downloads).toHaveLength(2)
  })

  it.each(['all devices', 'fitter devices'])('rejects an installation missing %s despite successful process exits', async (missing) => {
    fixture.devices = missing !== 'all devices'
    fixture.fitterDevices = missing !== 'fitter devices'
    const { default: setup } = await import('@@/scripts/setup/setup-llama-cpp')

    await expect(setup(GPU)).rejects.toThrow('cannot use the detected GPU')
    expect(await fs.stat(manifestPath).catch(() => null)).toBeNull()
    expect(fixture.succeed).not.toHaveBeenCalled()
    expect(await fs.readdir(runtimeRoot)).toEqual(['build'])
  })

  it('leaves failed runtime downloads retryable without publishing an incomplete installation', async () => {
    fixture.runtimeStatus = 503
    const { default: setup } = await import('@@/scripts/setup/setup-llama-cpp')

    await expect(setup(GPU)).rejects.toThrow()
    expect(await fs.stat(manifestPath).catch(() => null)).toBeNull()
    expect(fixture.succeed).not.toHaveBeenCalled()

    fixture.runtimeStatus = 200
    expect(await setup(GPU)).toBe(true)
    expect(await fs.stat(manifestPath)).toBeDefined()
    expect(await fs.readdir(runtimeRoot)).toEqual(['build'])
  })

  it('installs a CPU runtime without requiring GPU devices or CUDA downloads', async () => {
    fixture.devices = false
    const { default: setup } = await import('@@/scripts/setup/setup-llama-cpp')

    expect(await setup({ hasGPU: false, graphicsComputeAPI: 'cpu' })).toBe(true)
    expect(fixture.downloads).toHaveLength(1)
    expect(await fs.stat(manifestPath)).toBeDefined()
  })

  it.each(['linux', 'darwin'])('refuses to reuse or publish a %s runtime without its detected GPU', async (platform) => {
    fixture.platform = platform
    fixture.devices = false
    await writeBinaries(binaryDirectory, '')
    await fs.writeFile(manifestPath, JSON.stringify({
      version: 'fixture-release', runtimePath: path.relative(buildRoot, binaryDirectory)
    }))
    const { default: setup } = await import('@@/scripts/setup/setup-llama-cpp')

    await expect(setup({ hasGPU: true, graphicsComputeAPI: platform === 'linux' ? 'cuda' : 'metal' }))
      .rejects.toThrow('cannot use the detected GPU')
    expect(await fs.stat(manifestPath).catch(() => null)).toBeNull()
    expect(fixture.succeed).not.toHaveBeenCalled()
  })
})
