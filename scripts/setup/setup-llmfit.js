import path from 'node:path'

import { LLMFIT_INSTALL_PATH, LLMFIT_MANIFEST_PATH, LLMFIT_VERSION } from '@/constants'
import { SystemHelper } from '@/helpers/system-helper'
import { CPUArchitectures } from '@/types'

import { setupRuntimeBinary } from './setup-runtime-binary'

/**
 * Install the hardware-aware model planner only for local AI setup.
 */
export default async function setupLLMFit() {
  const { cpuArchitecture, type } = SystemHelper.getInformation()
  const architecture = cpuArchitecture === CPUArchitectures.ARM64
    ? 'aarch64'
    : cpuArchitecture === CPUArchitectures.X64 ? 'x86_64' : null
  const platform = SystemHelper.isWindows()
    ? 'pc-windows-msvc'
    : SystemHelper.isMacOS()
      ? 'apple-darwin'
      : SystemHelper.isLinux() ? 'unknown-linux-musl' : null

  if (!architecture || !platform) {
    throw new Error(`Unsupported platform for llmfit: ${type} ${cpuArchitecture}`)
  }

  const extension = SystemHelper.isWindows() ? 'zip' : 'tar.gz'
  const archiveFileName = `llmfit-v${LLMFIT_VERSION}-${architecture}-${platform}.${extension}`

  await setupRuntimeBinary({
    name: 'llmfit',
    version: LLMFIT_VERSION,
    basePath: LLMFIT_INSTALL_PATH,
    installPath: LLMFIT_INSTALL_PATH,
    manifestPath: LLMFIT_MANIFEST_PATH,
    binaryPath: path.join(LLMFIT_INSTALL_PATH, SystemHelper.isWindows() ? 'llmfit.exe' : 'llmfit'),
    downloadURL: `https://github.com/AlexsJones/llmfit/releases/download/v${LLMFIT_VERSION}/${archiveFileName}`,
    archiveFileName
  })
}
