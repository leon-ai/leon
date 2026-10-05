import path from 'node:path'

import { JQ_INSTALL_PATH, JQ_MANIFEST_PATH, JQ_VERSION } from '@/constants'
import { CPUArchitectures } from '@/types'
import { SystemHelper } from '@/helpers/system-helper'

import { setupRuntimeBinary } from './setup-runtime-binary'

/**
 * Install the official JSON processor independently of Node dependencies.
 */
export default async function setupJQ() {
  const { cpuArchitecture } = SystemHelper.getInformation()
  const architecture = cpuArchitecture === CPUArchitectures.ARM64 ? 'arm64' : 'amd64'
  const platform = SystemHelper.isWindows()
    ? 'windows'
    : SystemHelper.isMacOS()
      ? 'macos'
      : SystemHelper.isLinux()
        ? 'linux'
        : null

  if (!platform) {
    throw new Error(`Unsupported platform for jq: ${SystemHelper.getInformation().type}`)
  }

  const executable = SystemHelper.isWindows() ? 'jq.exe' : 'jq'
  const asset = `jq-${platform}-${architecture}${SystemHelper.isWindows() ? '.exe' : ''}`

  await setupRuntimeBinary({
    name: 'jq',
    version: JQ_VERSION,
    basePath: JQ_INSTALL_PATH,
    installPath: JQ_INSTALL_PATH,
    manifestPath: JQ_MANIFEST_PATH,
    binaryPath: path.join(JQ_INSTALL_PATH, executable),
    downloadURL: `https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}/${asset}`
  })
}
