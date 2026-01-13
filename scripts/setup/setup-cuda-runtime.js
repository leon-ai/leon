import fs from 'node:fs'

import extractZip from 'extract-zip'

import {
  CUDA_RUNTIME_PATH,
  CUDA_CUBLAS_PATH,
  CUDA_CUDNN_PATH,
  CUDA_CUBLAS_MANIFEST_PATH,
  CUDA_CUDNN_MANIFEST_PATH,
  CUDA_VERSION,
  CUDA_CUBLAS_VERSION,
  CUDA_CUDNN_VERSION
} from '@/constants'
import { FileHelper } from '@/helpers/file-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { LogHelper } from '@/helpers/log-helper'

const { type: OS_TYPE } = SystemHelper.getInformation()

/**
 * Read manifest file to get installed version
 */
function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8')

    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Extract tar.xz file using system tar command
 */
async function extractTarXz(archivePath, targetPath) {
  const { execSync } = await import('node:child_process')

  execSync(`tar -xf "${archivePath}" -C "${targetPath}" --strip-components=1`, {
    stdio: 'inherit'
  })
}

/**
 * Get download URL for CUDA library
 */
function getCUDADownloadURL(library, version) {
  const ext = SystemHelper.isWindows() ? 'zip' : 'tar.xz'

  // NVIDIA CDN URLs for CUDA libraries
  if (library === 'cublas') {
    return `https://developer.download.nvidia.com/compute/cuda/redist/libcublas/${OS_TYPE}-x86_64/libcublas-${OS_TYPE}-x86_64-${version}-archive.${ext}`
  } else if (library === 'cudnn') {
    return `https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/${OS_TYPE}-x86_64/cudnn-${OS_TYPE}-x86_64-${version}_cuda${CUDA_VERSION}-archive.${ext}`
  }

  throw new Error(`Unknown library: ${library}`)
}

/**
 * Install CUDA library if needed
 */
async function installCUDALibrary(
  library,
  requiredVersion,
  targetPath,
  manifestPath
) {
  const manifest = readManifest(manifestPath)
  const installedVersion = manifest?.version

  if (installedVersion) {
    LogHelper.info(`Found ${library} ${installedVersion}`)
    LogHelper.info(`Latest version is ${requiredVersion}`)
  }

  if (!manifest || manifest.version !== requiredVersion) {
    const ext = SystemHelper.isWindows() ? 'zip' : 'tar.xz'
    const archivePath = `${CUDA_RUNTIME_PATH}/${library}-${requiredVersion}.${ext}`

    // Clean up old version
    await fs.promises.rm(targetPath, { recursive: true, force: true })
    await fs.promises.rm(archivePath, { force: true })

    // Create target directory
    await fs.promises.mkdir(targetPath, { recursive: true })

    try {
      const downloadURL = getCUDADownloadURL(library, requiredVersion)

      LogHelper.info(`Downloading ${library}...`)

      await FileHelper.downloadFile(downloadURL, archivePath, {
        cliProgress: true,
        parallelStreams: 3,
        skipExisting: false
      })

      LogHelper.success(`${library} downloaded`)
      LogHelper.info(`Extracting ${library}...`)

      // Extract archive
      if (SystemHelper.isWindows()) {
        await extractZip(archivePath, { dir: targetPath })
      } else {
        await extractTarXz(archivePath, targetPath)
      }

      LogHelper.success(`${library} extracted`)

      // Clean up and create manifest
      await Promise.all([
        fs.promises.rm(archivePath, { force: true }),
        FileHelper.createManifestFile(manifestPath, library, requiredVersion, {
          os: SystemHelper.getInformation().type,
          architecture: SystemHelper.getInformation().cpuArchitecture
        })
      ])

      LogHelper.success(`${library} manifest file created`)
      LogHelper.success(`${library} ${requiredVersion} ready`)
    } catch (error) {
      LogHelper.error(`Failed to install ${library}: ${error}`)
      LogHelper.warning(
        'CUDA libraries may require manual download from NVIDIA website'
      )
      LogHelper.warning(
        'Please visit: https://developer.nvidia.com/cuda-downloads'
      )

      throw error
    }
  } else {
    LogHelper.success(
      `${library} is already at the latest version (${requiredVersion})`
    )
  }
}

/**
 * Main setup function
 */
async function setupCUDARuntime() {
  // Skip on macOS since there is no CUDA involved
  if (SystemHelper.isMacOS()) {
    return
  }

  LogHelper.info('Downloading and setting up CUDA runtime...')

  try {
    const { getLlama, LlamaLogLevel } = await Function(
      'return import("node-llama-cpp")'
    )()
    const llama = await getLlama({
      logLevel: LlamaLogLevel.disabled
    })

    const hasGPU = await SystemHelper.hasGPU(llama)

    if (!hasGPU) {
      LogHelper.info('No GPU detected. Skipping CUDA runtime setup')
      return
    }

    // Install/update cuBLAS
    await installCUDALibrary(
      'cublas',
      CUDA_CUBLAS_VERSION,
      CUDA_CUBLAS_PATH,
      CUDA_CUBLAS_MANIFEST_PATH
    )

    // Install/update cuDNN
    await installCUDALibrary(
      'cudnn',
      CUDA_CUDNN_VERSION,
      CUDA_CUDNN_PATH,
      CUDA_CUDNN_MANIFEST_PATH
    )

    LogHelper.success(`CUDA runtime setup complete in: ${CUDA_RUNTIME_PATH}`)
  } catch (error) {
    LogHelper.error(`CUDA runtime setup failed: ${error}`)
    process.exit(1)
  }
}

export default setupCUDARuntime
