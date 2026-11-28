import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'

import { create as createTarArchive } from 'tar'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createZipArchive, extractZipArchive } from '@sdk/utils/archive'

const fixture = await vi.hoisted(async () => {
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')

  return {
    root: await fs.mkdtemp(path.join(os.tmpdir(), 'leon-llamacpp-install-')),
    platform: 'win32', architecture: 'x64', endpoint: '', devices: true, fitterDevices: true,
    cudaFitterUsesVulkan: false, runtimeStatus: 200, downloads: [] as string[],
    succeed: vi.fn(), fail: vi.fn(), warning: vi.fn()
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
  getInformation: (): object => ({ cpuArchitecture: fixture.architecture, type: fixture.platform }),
  isWindows: (): boolean => fixture.platform === 'win32',
  isLinux: (): boolean => fixture.platform === 'linux',
  isMacOS: (): boolean => fixture.platform === 'darwin',
  hasGPU: (): boolean => false,
  getGraphicsComputeAPI: (): string => 'cpu',
  getGPUDeviceNames: (): string[] => [],
  getTotalVRAM: (): number => 0,
  getNvidiaGPUInfo: (): object => ({ names: ['Fixture NVIDIA GPU'], totalVRAM: 16 }),
  canSupportLocalLLM: (total: number): boolean => total > 0
} }))
vi.mock('@/helpers/file-helper', async (load) => {
  const { FileHelper } = await load<typeof import('@/helpers/file-helper')>()

  return { FileHelper: {
    createManifestFile: FileHelper.createManifestFile,
    // Exercise real downloads and archives through an isolated release server.
    downloadFile: async (url: string, destination: string): Promise<void> => {
      fixture.downloads.push(url)
      await FileHelper.downloadFile(`${fixture.endpoint}/${path.basename(url)}`, destination, {
        cliProgress: false, retry: { retries: 0 }, retryFetchDownloadInfo: { retries: 0 }
      })
    },
    extractArchive: (archive: string, destination: string, options?: { stripComponents?: number }): Promise<void> =>
      archive.endsWith('.zip')
        ? extractZipArchive(archive, destination)
        : FileHelper.extractArchive(archive, destination, options)
  } }
})
vi.mock('@/helpers/runtime-helper', async (load) => {
  const actual = await load<typeof import('@/helpers/runtime-helper')>()
  const { execa } = await import('execa')

  return { RuntimeHelper: class extends actual.RuntimeHelper {
    // Portable subprocess fixtures stand in for platform-specific native binaries.
    static override async runBinary(binary: string, args: string[]): Promise<string> {
      const { stdout } = await execa(process.execPath, [binary, ...args], {
        env: {
          LEON_TEST_LLAMA_DEVICES: String(fixture.devices),
          LEON_TEST_LLAMA_FITTER_DEVICES: String(fixture.fitterDevices),
          LEON_TEST_CUDA_FITTER_USES_VULKAN: String(fixture.cudaFitterUsesVulkan)
        }
      })

      return stdout
    }
  } }
})
vi.mock('@@/scripts/setup/setup-status', () => ({
  createSetupStatus: (): object => {
    const status = { text: '', isSpinning: false, succeed: fixture.succeed, fail: fixture.fail,
      start: (): object => status, pause: (): object => status }

    return status
  }
}))
vi.mock('@@/scripts/setup/setup-ui', () => ({ SetupUI: { warning: fixture.warning } }))

const CUDA_DLLS = ['cudart64_12.dll', 'cublas64_12.dll', 'cublasLt64_12.dll']
const LINUX_CUDA_LIBRARY = 'libcudart.so'
const GPU = { hasGPU: true, graphicsComputeAPI: 'cuda' }
const runtimeRoot = path.join(fixture.root, 'runtime')
const buildRoot = path.join(runtimeRoot, 'build')
const manifestPath = path.join(buildRoot, 'manifest.json')
const binaryDirectory = path.join(buildRoot, 'nested', 'bin')
const legacySourcePath = path.join(runtimeRoot, 'source')
const binarySource = `
const fs = require('node:fs')
const path = require('node:path')
if (process.argv.includes('--version')) {
  console.log('fixture runtime')
} else if (process.argv.includes('--list-devices')) {
  const backend = fs.readFileSync(path.join(__dirname, 'backend'), 'utf8')
  const libraries = __filename.endsWith('.exe') ? ${JSON.stringify(CUDA_DLLS)} : [${JSON.stringify(LINUX_CUDA_LIBRARY)}]
  const hasLibraries = backend !== 'CUDA' ||
    libraries.every((name) => fs.existsSync(path.join(__dirname, name)))
  const fitter = __filename.includes('fit-params')
  const usable = hasLibraries && process.env.LEON_TEST_LLAMA_DEVICES === 'true' &&
    (!fitter || process.env.LEON_TEST_LLAMA_FITTER_DEVICES === 'true')
  const device = backend === 'CUDA' && fitter &&
    process.env.LEON_TEST_CUDA_FITTER_USES_VULKAN === 'true' ? 'Vulkan' : backend
  console.error('load_backend: loaded CPU backend; CUDA0: backend candidate')
  console.log('Available devices:')
  console.log(usable ? '  ' + device + '0: Fixture GPU (16384 MiB, 15000 MiB free)' : '  (none)')
} else {
  process.exitCode = 1
}
`
let binaries: Buffer
let libraries: Buffer
let linuxCuda: Buffer
let linuxVulkan: Buffer
let linuxLibraries: Buffer
const server = createServer((request, response) => {
  const asset = request.url ?? ''
  const runtime = asset.startsWith('/cudart-')
  const body = asset.endsWith('.zip') ? (runtime ? libraries : binaries)
    : (runtime ? linuxLibraries : asset.includes('-cuda-') ? linuxCuda : linuxVulkan)
  response.writeHead(runtime ? fixture.runtimeStatus : 200, { 'content-length': body.length })
  response.end(body)
})

/**
 * Create isolated executable fixtures with the same nested layout as a release.
 */
async function writeBinaries(directory: string, suffix: string, backend = 'CUDA'): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  for (const name of ['llama-server', 'llama-fit-params']) {
    await fs.writeFile(path.join(directory, `${name}${suffix}`), binarySource)
  }
  await fs.writeFile(path.join(directory, 'backend'), backend)
}

async function packLinux(directory: string): Promise<Buffer> {
  const archive = `${directory}.tar.gz`
  await createTarArchive({
    file: archive, gzip: true, cwd: path.dirname(directory)
  }, [path.basename(directory)])

  return fs.readFile(archive)
}

async function readInstalledDirectory(): Promise<string> {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))

  return path.resolve(buildRoot, manifest.runtimePath)
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

  const linuxCudaRoot = path.join(fixture.root, 'linux-cuda')
  const linuxVulkanRoot = path.join(fixture.root, 'linux-vulkan')
  const linuxLibraryRoot = path.join(fixture.root, 'linux-runtime-libraries')
  await writeBinaries(linuxCudaRoot, '')
  await writeBinaries(linuxVulkanRoot, '', 'Vulkan')
  await fs.mkdir(linuxLibraryRoot)
  await fs.writeFile(path.join(linuxLibraryRoot, LINUX_CUDA_LIBRARY), 'runtime library fixture')
  linuxCuda = await packLinux(linuxCudaRoot)
  linuxVulkan = await packLinux(linuxVulkanRoot)
  linuxLibraries = await packLinux(linuxLibraryRoot)

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
  fixture.architecture = 'x64'
  fixture.devices = true
  fixture.fitterDevices = true
  fixture.cudaFitterUsesVulkan = false
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

    const installedDirectory = await readInstalledDirectory()
    for (const dll of CUDA_DLLS) {
      expect(await fs.readFile(path.join(installedDirectory, dll), 'utf8')).toBe('runtime library fixture')
    }
    expect(fixture.downloads).toHaveLength(2)
    expect(fixture.downloads.every((url) => new URL(url).pathname.includes('/fixture-release/'))).toBe(true)
    expect(path.relative(buildRoot, installedDirectory)).toMatch(/nested[/\\]bin$/)
    expect(await fs.readdir(runtimeRoot)).toEqual(['build'])
  })

  it('repairs a GPU installation that starts without exposing a device and then reuses it', async () => {
    await writeBinaries(binaryDirectory, '.exe')
    await fs.writeFile(manifestPath, JSON.stringify({
      version: 'fixture-release', runtimePath: path.relative(buildRoot, binaryDirectory)
    }))
    const { default: setup } = await import('@@/scripts/setup/setup-llama-cpp')

    expect(await setup(GPU)).toBe(true)
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

    const result = setup({ hasGPU: true, graphicsComputeAPI: platform === 'linux' ? 'cuda' : 'metal' })
    if (platform === 'linux') {
      await expect(result).resolves.toBe(false)
      expect(fixture.fail).toHaveBeenCalledWith(expect.stringContaining('cannot use the detected GPU'))
    } else {
      await expect(result).rejects.toThrow('cannot use the detected GPU')
    }
    expect(await readInstalledDirectory()).toBe(binaryDirectory)
    expect(fixture.succeed).not.toHaveBeenCalled()
  })

  it.each([
    ['x64', '12.8'],
    ['arm64', '13.5']
  ])('installs the Linux %s CUDA bundle when the driver detects a GPU', async (arch, version) => {
    fixture.platform = 'linux'
    fixture.architecture = arch
    const legacyDirectory = path.join(legacySourcePath, 'build', 'bin')
    await writeBinaries(legacyDirectory, '', 'Vulkan')
    await fs.writeFile(path.join(legacySourcePath, 'manifest.json'), JSON.stringify({
      version: 'fixture-release', runtimePath: path.relative(legacySourcePath, legacyDirectory)
    }))
    const { default: setup } = await import('@@/scripts/setup/setup-llama-cpp')
    const { getLlamaCPPServerBinaryPath } = await import('@/core/llm-manager/llm-providers/llamacpp-context')

    expect(getLlamaCPPServerBinaryPath()).toBe(path.join(legacyDirectory, 'llama-server'))
    expect(await setup()).toBe(true)

    const asset = `llama-fixture-release-bin-ubuntu-cuda-${version}-${arch}.tar.gz`
    expect(fixture.downloads.map((url) => path.basename(url))).toEqual([asset, `cudart-${asset}`])
    const directory = await readInstalledDirectory()
    expect(await fs.readFile(path.join(directory, LINUX_CUDA_LIBRARY), 'utf8')).toBe('runtime library fixture')
    expect(getLlamaCPPServerBinaryPath()).toBe(path.join(directory, 'llama-server'))
    expect(await fs.stat(path.join(legacyDirectory, 'llama-server'))).toBeDefined()
    expect(await setup()).toBe(true)
    expect(fixture.downloads).toHaveLength(2)
  })

  it('falls back to the Linux Vulkan bundle when the CUDA fitter exposes the wrong backend', async () => {
    fixture.platform = 'linux'
    fixture.cudaFitterUsesVulkan = true
    const { default: setup } = await import('@@/scripts/setup/setup-llama-cpp')

    expect(await setup(GPU)).toBe(true)
    expect(fixture.downloads.map((url) => path.basename(url))).toEqual([
      'llama-fixture-release-bin-ubuntu-cuda-12.8-x64.tar.gz',
      'cudart-llama-fixture-release-bin-ubuntu-cuda-12.8-x64.tar.gz',
      'llama-fixture-release-bin-ubuntu-vulkan-x64.tar.gz'
    ])
    expect(await fs.readFile(path.join(await readInstalledDirectory(), 'backend'), 'utf8')).toBe('Vulkan')
    expect(fixture.warning).toHaveBeenCalled()
  })

  it('retains a working Linux Vulkan installation when the CUDA runtime cannot be downloaded', async () => {
    fixture.platform = 'linux'
    fixture.runtimeStatus = 503
    await writeBinaries(binaryDirectory, '', 'Vulkan')
    const previous = JSON.stringify({
      version: 'fixture-release', runtimePath: path.relative(buildRoot, binaryDirectory)
    })
    await fs.writeFile(manifestPath, previous)
    const { default: setup } = await import('@@/scripts/setup/setup-llama-cpp')

    expect(await setup(GPU)).toBe(true)
    expect(fixture.downloads).toHaveLength(2)
    expect(await fs.readFile(manifestPath, 'utf8')).toBe(previous)
  })
})
