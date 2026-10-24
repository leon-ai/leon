import fs from 'node:fs'
import path from 'node:path'

import { execa } from 'execa'

import { CPUArchitectures } from '@/types'
import {
  LLAMACPP_BUILD_MANIFEST_PATH,
  CMAKE_BIN_PATH,
  LLAMACPP_BUILD_PATH,
  LLAMACPP_ROOT_MANIFEST_PATH,
  NINJA_BIN_PATH,
  LLAMACPP_SOURCE_BUILD_PATH,
  LLAMACPP_SOURCE_MANIFEST_PATH,
  LLAMACPP_SOURCE_PATH,
  LLAMACPP_PATH,
  LLAMACPP_RELEASE_VERSION
} from '@/constants'
import { FileHelper } from '@/helpers/file-helper'
import { SystemHelper } from '@/helpers/system-helper'

import { createSetupStatus } from './setup-status'
import { SetupUI } from './setup-ui'

/**
 * Download and set up llama.cpp
 * 1. Resolve the release version from versions.json
 * 2. Build from source on Linux + CUDA when required
 * 3. Otherwise download the matching prebuilt archive
 * 4. Keep the final binaries in their stable runtime directory
 */

const MOVE_FALLBACK_ERROR_CODES = new Set(['EXDEV', 'EPERM', 'EBUSY', 'EACCES'])
const { cpuArchitecture: CPU_ARCH } = SystemHelper.getInformation()
const LLAMA_SERVER_BINARY_NAME = SystemHelper.isWindows()
  ? 'llama-server.exe'
  : 'llama-server'
const LLAMACPP_SOURCE_DOWNLOAD_MAX_ATTEMPTS = 2
const LLAMACPP_SOURCE_ARCHIVE_SETTLE_DELAY_MS = 500
const LLAMACPP_SOURCE_ARCHIVE_SETTLE_POLL_DELAY_MS = 250
const LLAMACPP_SOURCE_ARCHIVE_SETTLE_MAX_POLLS = 6
const LLAMACPP_RELEASE_BASE_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMACPP_RELEASE_VERSION}`
const LLAMACPP_SOURCE_URL = `https://github.com/ggml-org/llama.cpp/archive/refs/tags/${LLAMACPP_RELEASE_VERSION}.tar.gz`

function readManifest() {
  const manifestEntries = [
    {
      manifestPath: LLAMACPP_SOURCE_MANIFEST_PATH,
      runtimeBasePath: LLAMACPP_SOURCE_PATH
    },
    {
      manifestPath: LLAMACPP_BUILD_MANIFEST_PATH,
      runtimeBasePath: LLAMACPP_BUILD_PATH
    },
    // Keep compatibility with the previous root-level manifest layout.
    {
      manifestPath: LLAMACPP_ROOT_MANIFEST_PATH,
      runtimeBasePath: LLAMACPP_PATH
    }
  ]

  for (const manifestEntry of manifestEntries) {
    if (!fs.existsSync(manifestEntry.manifestPath)) {
      continue
    }

    try {
      const manifest = JSON.parse(
        fs.readFileSync(manifestEntry.manifestPath, 'utf8')
      )
      const runtimeDirectoryPath =
        typeof manifest.runtimePath === 'string' && manifest.runtimePath.trim()
          ? path.join(manifestEntry.runtimeBasePath, manifest.runtimePath)
          : null

      return {
        manifest,
        runtimeDirectoryPath
      }
    } catch {
      return null
    }
  }

  return null
}

async function removePath(targetPath) {
  await fs.promises.rm(targetPath, { recursive: true, force: true })
}

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

function isMoveFallbackError(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    MOVE_FALLBACK_ERROR_CODES.has(error.code)
  )
}

async function movePath(sourcePath, destinationPath) {
  await removePath(destinationPath)

  try {
    await fs.promises.rename(sourcePath, destinationPath)
  } catch (error) {
    if (!isMoveFallbackError(error)) {
      throw error
    }

    await fs.promises.cp(sourcePath, destinationPath, {
      recursive: true,
      force: true
    })
    await removePath(sourcePath)
  }
}

function getBinaryPath(directoryPath) {
  return path.join(directoryPath, LLAMA_SERVER_BINARY_NAME)
}

async function isExistingInstallationHealthy(runtimeDirectoryPath) {
  if (!runtimeDirectoryPath) {
    return false
  }

  const binaryPath = getBinaryPath(runtimeDirectoryPath)

  if (!fs.existsSync(binaryPath)) {
    return false
  }

  try {
    await execa(binaryPath, ['--version'])

    return true
  } catch {
    return false
  }
}

async function findDirectoryContainingBinary(rootPath, binaryName) {
  const entries = await fs.promises.readdir(rootPath, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name)

    if (entry.isDirectory()) {
      const maybeBinDir = await findDirectoryContainingBinary(
        entryPath,
        binaryName
      )

      if (maybeBinDir) {
        return maybeBinDir
      }
    } else if (entry.isFile() && entry.name === binaryName) {
      return path.dirname(entryPath)
    }
  }

  return null
}

async function cleanInstallDirectory() {
  await fs.promises.mkdir(LLAMACPP_PATH, { recursive: true })

  const entries = await fs.promises.readdir(LLAMACPP_PATH, {
    withFileTypes: true
  })

  await Promise.all(
    entries
      .filter((entry) => entry.name !== 'versions.json')
      .map((entry) => removePath(path.join(LLAMACPP_PATH, entry.name)))
  )
}

async function writeManifest(
  manifestPath,
  runtimeBasePath,
  runtimeDirectoryPath,
  extraData = {}
) {
  await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true })

  await FileHelper.createManifestFile(
    manifestPath,
    'llama.cpp',
    LLAMACPP_RELEASE_VERSION,
    {
      runtimePath: path.relative(runtimeBasePath, runtimeDirectoryPath),
      os: SystemHelper.getInformation().type,
      architecture: SystemHelper.getInformation().cpuArchitecture,
      ...extraData
    }
  )
}

async function pruneSourceTree() {
  const buildDirectoryPath = path.join(LLAMACPP_SOURCE_PATH, 'build')
  const temporaryRetainedPath = await fs.promises.mkdtemp(
    path.join(LLAMACPP_PATH, 'llama-cpp-build-bin-')
  )
  const retainedBuildBinPath = path.join(temporaryRetainedPath, 'bin')

  await movePath(LLAMACPP_SOURCE_BUILD_PATH, retainedBuildBinPath)
  await removePath(LLAMACPP_SOURCE_PATH)
  await fs.promises.mkdir(buildDirectoryPath, { recursive: true })
  await movePath(retainedBuildBinPath, LLAMACPP_SOURCE_BUILD_PATH)
  await removePath(temporaryRetainedPath)
}

async function waitForArchiveToSettle(archivePath) {
  // Give the download layer a short margin, then wait until the archive size
  // stops changing before extracting it.
  await wait(LLAMACPP_SOURCE_ARCHIVE_SETTLE_DELAY_MS)

  let previousSize = -1

  for (let poll = 0; poll < LLAMACPP_SOURCE_ARCHIVE_SETTLE_MAX_POLLS; poll += 1) {
    const currentSize = (await fs.promises.stat(archivePath)).size

    if (currentSize > 0 && currentSize === previousSize) {
      return
    }

    previousSize = currentSize
    await wait(LLAMACPP_SOURCE_ARCHIVE_SETTLE_POLL_DELAY_MS)
  }
}

async function downloadAndExtractSourceArchive(sourceArchivePath) {
  for (
    let attempt = 1;
    attempt <= LLAMACPP_SOURCE_DOWNLOAD_MAX_ATTEMPTS;
    attempt += 1
  ) {
    await Promise.all([
      removePath(sourceArchivePath),
      removePath(LLAMACPP_SOURCE_PATH)
    ])

    await FileHelper.downloadFile(LLAMACPP_SOURCE_URL, sourceArchivePath, {
      cliProgress: true,
      // Keep the source archive download conservative to avoid corrupted
      // segmented downloads before extraction.
      parallelStreams: 1,
      skipExisting: false
    })

    await waitForArchiveToSettle(sourceArchivePath)

    try {
      await FileHelper.extractArchive(sourceArchivePath, LLAMACPP_SOURCE_PATH, {
        stripComponents: 1
      })

      return
    } catch (error) {
      if (attempt === LLAMACPP_SOURCE_DOWNLOAD_MAX_ATTEMPTS) {
        throw error
      }

      await wait(LLAMACPP_SOURCE_ARCHIVE_SETTLE_POLL_DELAY_MS)
    }
  }
}

function getLinuxVulkanAssetName() {
  return `llama-${LLAMACPP_RELEASE_VERSION}-bin-ubuntu-vulkan-x64.tar.gz`
}

function getLinuxCPUAssetName() {
  return `llama-${LLAMACPP_RELEASE_VERSION}-bin-ubuntu-x64.tar.gz`
}

function getWindowsCPUAssetName() {
  return `llama-${LLAMACPP_RELEASE_VERSION}-bin-win-cpu-x64.zip`
}

function getPrebuiltAssetName(graphicsComputeAPI, hasGPU) {
  if (SystemHelper.isMacOS()) {
    return CPU_ARCH === CPUArchitectures.ARM64
      ? `llama-${LLAMACPP_RELEASE_VERSION}-bin-macos-arm64.tar.gz`
      : `llama-${LLAMACPP_RELEASE_VERSION}-bin-macos-x64.tar.gz`
  }

  if (SystemHelper.isWindows()) {
    if (hasGPU && graphicsComputeAPI === 'cuda') {
      return `llama-${LLAMACPP_RELEASE_VERSION}-bin-win-cuda-12.4-x64.zip`
    }

    if (hasGPU && graphicsComputeAPI === 'vulkan') {
      return `llama-${LLAMACPP_RELEASE_VERSION}-bin-win-vulkan-x64.zip`
    }

    return getWindowsCPUAssetName()
  }

  if (SystemHelper.isLinux() && CPU_ARCH === CPUArchitectures.X64) {
    return hasGPU && graphicsComputeAPI === 'vulkan'
      ? getLinuxVulkanAssetName()
      : getLinuxCPUAssetName()
  }

  throw new Error(
    `Unsupported llama.cpp prebuilt platform: ${SystemHelper.getInformation().type} ${CPU_ARCH}`
  )
}

async function installPrebuilt(assetName, status, extraData = {}) {
  const archivePath = path.join(LLAMACPP_PATH, assetName)

  try {
    await cleanInstallDirectory()
    status.pause()

    await FileHelper.downloadFile(
      `${LLAMACPP_RELEASE_BASE_URL}/${assetName}`,
      archivePath,
      {
        cliProgress: true,
        parallelStreams: 3,
        skipExisting: false
      }
    )
    status.text = 'Installing llama.cpp...'
    status.start()

    await FileHelper.extractArchive(archivePath, LLAMACPP_BUILD_PATH)

    // Use the directory that actually contains llama-server so we do not rely
    // on a fixed archive layout across upstream release assets.
    const binaryDirectoryPath = await findDirectoryContainingBinary(
      LLAMACPP_BUILD_PATH,
      LLAMA_SERVER_BINARY_NAME
    )

    if (!binaryDirectoryPath) {
      throw new Error(
        `Cannot find ${LLAMA_SERVER_BINARY_NAME} in extracted llama.cpp archive`
      )
    }

    await writeManifest(
      LLAMACPP_BUILD_MANIFEST_PATH,
      LLAMACPP_BUILD_PATH,
      binaryDirectoryPath,
      {
        installType: 'prebuilt',
        ...extraData
      }
    )
    status.succeed(`llama.cpp ${LLAMACPP_RELEASE_VERSION} ready`)
  } finally {
    await removePath(archivePath)
  }
}

async function buildFromSource(status) {
  const sourceArchivePath = path.join(
    LLAMACPP_PATH,
    `llama.cpp-${LLAMACPP_RELEASE_VERSION}.tar.gz`
  )

  try {
    await cleanInstallDirectory()

    status.pause()
    await downloadAndExtractSourceArchive(sourceArchivePath)
    status.text = 'Building llama.cpp from source...'
    status.start()

    // Always use Leon-managed CMake for the source build.
    await execa(
      CMAKE_BIN_PATH,
      [
        '-B',
        'build',
        '-G',
        'Ninja',
        `-DCMAKE_MAKE_PROGRAM=${NINJA_BIN_PATH}`,
        '-DGGML_CUDA=ON',
        '-DLLAMA_BUILD_SERVER=ON',
        '-DLLAMA_BUILD_TESTS=OFF',
        '-DLLAMA_BUILD_EXAMPLES=OFF',
        '-DCMAKE_BUILD_TYPE=Release',
        '-DCMAKE_CUDA_ARCHITECTURES=native'
      ],
      {
        cwd: LLAMACPP_SOURCE_PATH
      }
    )
    await execa(CMAKE_BIN_PATH, ['--build', 'build', '--target', 'llama-server', '-j'], {
      cwd: LLAMACPP_SOURCE_PATH
    })

    if (
      !fs.existsSync(getBinaryPath(LLAMACPP_SOURCE_BUILD_PATH))
    ) {
      throw new Error(
        `Cannot find ${LLAMA_SERVER_BINARY_NAME} after building llama.cpp`
      )
    }

    // Retain only the runtime payload after a successful source build.
    await pruneSourceTree()
    await writeManifest(
      LLAMACPP_SOURCE_MANIFEST_PATH,
      LLAMACPP_SOURCE_PATH,
      LLAMACPP_SOURCE_BUILD_PATH,
      {
        installType: 'source'
      }
    )

    status.succeed(`llama.cpp ${LLAMACPP_RELEASE_VERSION} ready`)
  } finally {
    await removePath(sourceArchivePath)
  }
}

export default async function setupLlamaCPP() {
  const status = createSetupStatus('Setting up llama.cpp...').start()

  const existingInstallation = readManifest()
  const manifest = existingInstallation?.manifest
  const runtimeDirectoryPath = existingInstallation?.runtimeDirectoryPath || null

  if (
    manifest?.version === LLAMACPP_RELEASE_VERSION &&
    (await isExistingInstallationHealthy(runtimeDirectoryPath))
  ) {
    status.succeed(`llama.cpp: ${LLAMACPP_RELEASE_VERSION}`)

    return true
  }

  if (
    manifest?.version === LLAMACPP_RELEASE_VERSION &&
    runtimeDirectoryPath &&
    fs.existsSync(getBinaryPath(runtimeDirectoryPath))
  ) {
    status.pause()
    SetupUI.warning('The current llama.cpp installation looks corrupted. Reinstalling it.')
  }

  let hasGPU = false
  let graphicsComputeAPI = 'cpu'

  try {
    const { getLlama, LlamaLogLevel } = await Function(
      'return import("node-llama-cpp")'
    )()
    const llama = await getLlama({
      logLevel: LlamaLogLevel.disabled
    })

    hasGPU = await SystemHelper.hasGPU(llama)
    graphicsComputeAPI = await SystemHelper.getGraphicsComputeAPI(llama)
  } catch (error) {
      status.pause()
    SetupUI.warning(`Failed to inspect GPU support for llama.cpp setup: ${error}`)
  }

  if (SystemHelper.isLinux() && CPU_ARCH === CPUArchitectures.ARM64) {
    // Linux ARM64 only supports the local setup when a CUDA build is possible.
    if (!(hasGPU && graphicsComputeAPI === 'cuda')) {
      status.succeed(
        'Linux ARM64 local LLM support requires a CUDA GPU. Skipping llama.cpp setup.'
      )

      return false
    }

    try {
      await buildFromSource(status)

      return true
    } catch {
      if (status.isSpinning) {
        status.fail('Failed to build llama.cpp from source')
      }

      return false
    }
  }

  if (SystemHelper.isLinux() && hasGPU && graphicsComputeAPI === 'cuda') {
    try {
      await buildFromSource(status)

      return true
    } catch {
      SetupUI.warning(
        'I could not build llama.cpp from source, so I will use the Vulkan binaries instead.'
      )
      await installPrebuilt(getLinuxVulkanAssetName(), status, {
        fallbackFromSourceBuild: true
      })

      return true
    }
  }

  await installPrebuilt(
    getPrebuiltAssetName(graphicsComputeAPI, hasGPU),
    status
  )

  return true
}
