import fs from 'node:fs'
import path from 'node:path'

import { CPUArchitectures } from '@/types'
import {
  LLAMACPP_BUILD_MANIFEST_PATH,
  LLAMACPP_BUILD_PATH,
  LLAMACPP_PATH,
  LLAMACPP_RELEASE_VERSION
} from '@/constants'
import {
  listLlamaCPPDevices,
  readLlamaCPPInstallation
} from '@/core/llm-manager/llm-providers/llamacpp-context'
import { FileHelper } from '@/helpers/file-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { SystemHelper } from '@/helpers/system-helper'

import inspectLocalAICapability from './local-ai-capability'
import { createSetupStatus } from './setup-status'
import { SetupUI } from './setup-ui'

const BINARY_NAMES = ['llama-server', 'llama-fit-params']
const HEALTH_CHECK_TIMEOUT_MS = 10_000
const STAGING_PREFIX = '.install-'
const BUNDLE_PREFIX = 'bundle-'
const RELEASE_BASE_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMACPP_RELEASE_VERSION}`
const LINUX_CUDA_VERSIONS = {
  [CPUArchitectures.X64]: '12.8',
  [CPUArchitectures.ARM64]: '13.5'
}

function binaryName(name) {
  return SystemHelper.isWindows() ? `${name}.exe` : name
}

function prebuilt(suffix, backend) {
  return {
    asset: `llama-${LLAMACPP_RELEASE_VERSION}-${suffix}`,
    backend
  }
}

function getPrebuilts(hasGPU, graphicsComputeAPI) {
  const { cpuArchitecture } = SystemHelper.getInformation()
  const arm64 = cpuArchitecture === CPUArchitectures.ARM64

  if (SystemHelper.isMacOS()) {
    return [prebuilt(`bin-macos-${arm64 ? 'arm64' : 'x64'}.tar.gz`)]
  }

  if (SystemHelper.isWindows()) {
    if (hasGPU && graphicsComputeAPI === 'cuda') {
      const suffix = 'bin-win-cuda-12.4-x64.zip'

      return [{
        ...prebuilt(suffix, 'cuda'),
        cudaRuntimeAsset: `cudart-llama-${suffix}`
      }]
    }
    if (hasGPU && graphicsComputeAPI === 'vulkan') {
      return [prebuilt('bin-win-vulkan-x64.zip', 'vulkan')]
    }

    return [prebuilt('bin-win-cpu-x64.zip')]
  }

  if (SystemHelper.isLinux() && (arm64 || cpuArchitecture === CPUArchitectures.X64)) {
    if (!hasGPU) {
      return arm64 ? [] : [prebuilt('bin-ubuntu-x64.tar.gz')]
    }

    const arch = arm64 ? 'arm64' : 'x64'
    const vulkan = prebuilt(`bin-ubuntu-vulkan-${arch}.tar.gz`, 'vulkan')
    if (graphicsComputeAPI !== 'cuda') {
      return [vulkan]
    }

    const cuda = prebuilt(`bin-ubuntu-cuda-${LINUX_CUDA_VERSIONS[cpuArchitecture]}-${arch}.tar.gz`, 'cuda')

    return [{ ...cuda, cudaRuntimeAsset: `cudart-${cuda.asset}` }, vulkan]
  }

  throw new Error(
    `Unsupported llama.cpp prebuilt platform: ${SystemHelper.getInformation().type} ${cpuArchitecture}`
  )
}

async function isInstallationHealthy(directory, hasGPU, backend) {
  if (!directory) {
    return false
  }

  try {
    // Both executables must load the selected backend before it can be used
    // for fitting and inference.
    for (const name of BINARY_NAMES) {
      const binary = path.join(directory, binaryName(name))
      if (hasGPU) {
        const devices = await listLlamaCPPDevices(binary)
        if (!devices.some(({ id }) => !backend || id.toLowerCase().startsWith(backend))) {
          return false
        }
      } else {
        await RuntimeHelper.runBinary(binary, ['--version'], { timeoutMs: HEALTH_CHECK_TIMEOUT_MS })
      }
    }

    return true
  } catch {
    return false
  }
}

async function findBinaryDirectory(directory) {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true })
  if (entries.some((entry) => entry.isFile() && entry.name === binaryName(BINARY_NAMES[0]))) {
    return directory
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = await findBinaryDirectory(path.join(directory, entry.name))
      if (found) {
        return found
      }
    }
  }

  return null
}

async function downloadArchive(asset, staging, target, status, options) {
  const archive = path.join(staging, asset)
  status.pause()
  await FileHelper.downloadFile(`${RELEASE_BASE_URL}/${asset}`, archive, {
    cliProgress: true,
    parallelStreams: 3,
    skipExisting: false
  })
  status.text = 'Installing llama.cpp...'
  status.start()
  await FileHelper.extractArchive(archive, target, options)
}

async function installPrebuilt(candidate, status, hasGPU, previousDirectory) {
  await fs.promises.mkdir(LLAMACPP_BUILD_PATH, { recursive: true })
  const staging = await fs.promises.mkdtemp(path.join(LLAMACPP_PATH, STAGING_PREFIX))
  const extracted = path.join(staging, 'runtime')
  const bundle = path.join(LLAMACPP_BUILD_PATH,
    `${BUNDLE_PREFIX}${path.basename(staging).slice(STAGING_PREFIX.length)}`)
  let published = false

  try {
    await downloadArchive(candidate.asset, staging, extracted, status)
    const directory = await findBinaryDirectory(extracted)
    if (!directory) {
      throw new Error(`Cannot find ${binaryName(BINARY_NAMES[0])} in the llama.cpp archive.`)
    }

    if (candidate.cudaRuntimeAsset) {
      // The Linux runtime tarball wraps its libraries in a top-level directory.
      const options = SystemHelper.isLinux() ? { stripComponents: 1 } : undefined
      await downloadArchive(candidate.cudaRuntimeAsset, staging, directory, status, options)
    }

    if (!await isInstallationHealthy(directory, hasGPU, candidate.backend)) {
      throw new Error(hasGPU
        ? `I cannot use the detected GPU with my ${candidate.backend ?? 'llama.cpp'} runtime. Check its runtime libraries and graphics driver.`
        : 'I cannot start my llama.cpp runtime. Check its runtime libraries.')
    }

    // Publish the pointer only once the complete bundle can run. A failed
    // replacement leaves the previous manifest and binaries available.
    const manifest = path.join(staging, 'manifest.json')
    const installedDirectory = path.join(bundle, path.relative(extracted, directory))
    const { type, cpuArchitecture } = SystemHelper.getInformation()
    await FileHelper.createManifestFile(manifest, 'llama.cpp', LLAMACPP_RELEASE_VERSION, {
      runtimePath: path.relative(LLAMACPP_BUILD_PATH, installedDirectory),
      os: type,
      architecture: cpuArchitecture,
      installType: 'prebuilt',
      backend: candidate.backend
    })
    await fs.promises.rename(extracted, bundle)
    await fs.promises.rename(manifest, LLAMACPP_BUILD_MANIFEST_PATH)
    published = true
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true })
    if (!published) {
      await fs.promises.rm(bundle, { recursive: true, force: true })
    }
  }

  if (previousDirectory) {
    const previousBundle = path.relative(LLAMACPP_BUILD_PATH, previousDirectory).split(path.sep)[0]
    if (previousBundle.startsWith(BUNDLE_PREFIX)) {
      // Windows can keep a superseded executable locked until its process exits.
      await fs.promises.rm(path.join(LLAMACPP_BUILD_PATH, previousBundle), {
        recursive: true, force: true
      }).catch(() => {})
    }
  }

  status.succeed(`llama.cpp ${LLAMACPP_RELEASE_VERSION} ready`)
}

/**
 * Install a managed runtime and verify it can use the detected local hardware.
 */
export default async function setupLlamaCPP(localAICapability = null) {
  const status = createSetupStatus('Setting up llama.cpp...').start()
  const { hasGPU, graphicsComputeAPI } = localAICapability ?? await inspectLocalAICapability()
  const existing = readLlamaCPPInstallation()
  const candidates = getPrebuilts(hasGPU, graphicsComputeAPI)
  const isLinux = SystemHelper.isLinux()
  const requireGPU = hasGPU || candidates.length === 0
  let failure

  for (const candidate of candidates) {
    if (existing?.version === LLAMACPP_RELEASE_VERSION &&
        await isInstallationHealthy(existing.runtimeDirectory, requireGPU, candidate.backend)) {
      status.succeed(`llama.cpp: ${LLAMACPP_RELEASE_VERSION}`)

      return true
    }

    try {
      await installPrebuilt(candidate, status, requireGPU, existing?.runtimeDirectory)

      return true
    } catch (error) {
      if (!isLinux) {
        throw error
      }

      failure = error
      if (candidate.backend === 'cuda') {
        status.pause()
        SetupUI.warning(`I could not set up CUDA. I will try Vulkan. ${error.message}`)
      }
    }
  }

  if (await isInstallationHealthy(existing?.runtimeDirectory, requireGPU)) {
    status.succeed('I will keep my working llama.cpp installation.')

    return true
  }

  status.fail(failure?.message ?? 'I need a working GPU runtime to set up local AI on this machine.')

  return false
}
