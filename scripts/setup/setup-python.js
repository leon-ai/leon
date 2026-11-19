import path from 'node:path'

import {
  PYTHON_INSTALL_PATH,
  PYTHON_MANIFEST_PATH,
  PYTHON_VERSION
} from '@/constants'
import { CPUArchitectures } from '@/types'
import { SystemHelper } from '@/helpers/system-helper'

import { setupRuntimeBinary } from './setup-runtime-binary'

const { cpuArchitecture: CPU_ARCH } = SystemHelper.getInformation()
const PYTHON_RELEASE = PYTHON_VERSION.split('+')[1]

function getBinaryPath() {
  return SystemHelper.isWindows()
    ? path.join(PYTHON_INSTALL_PATH, 'python.exe')
    : path.join(PYTHON_INSTALL_PATH, 'bin', 'python')
}

function getAssetFileName() {
  if (SystemHelper.isLinux()) {
    if (CPU_ARCH === CPUArchitectures.X64) {
      return `cpython-${PYTHON_VERSION}-x86_64-unknown-linux-gnu-install_only.tar.gz`
    }

    if (CPU_ARCH === CPUArchitectures.ARM64) {
      return `cpython-${PYTHON_VERSION}-aarch64-unknown-linux-gnu-install_only.tar.gz`
    }
  }

  if (SystemHelper.isMacOS()) {
    if (CPU_ARCH === CPUArchitectures.X64) {
      return `cpython-${PYTHON_VERSION}-x86_64-apple-darwin-install_only.tar.gz`
    }

    if (CPU_ARCH === CPUArchitectures.ARM64) {
      return `cpython-${PYTHON_VERSION}-aarch64-apple-darwin-install_only.tar.gz`
    }
  }

  if (SystemHelper.isWindows()) {
    return CPU_ARCH === CPUArchitectures.ARM64
      ? `cpython-${PYTHON_VERSION}-aarch64-pc-windows-msvc-install_only.tar.gz`
      : `cpython-${PYTHON_VERSION}-x86_64-pc-windows-msvc-install_only.tar.gz`
  }

  throw new Error(
    `Unsupported platform for Python: ${SystemHelper.getInformation().type} ${CPU_ARCH}`
  )
}

export default async function setupPython() {
  const assetFileName = getAssetFileName()

  await setupRuntimeBinary({
    name: 'Python',
    version: PYTHON_VERSION,
    basePath: PYTHON_INSTALL_PATH,
    installPath: PYTHON_INSTALL_PATH,
    manifestPath: PYTHON_MANIFEST_PATH,
    binaryPath: getBinaryPath(),
    downloadURL: `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/${assetFileName}`,
    archiveFileName: assetFileName
  })
}
