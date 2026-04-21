import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'

import {
  CACHE_PATH,
  NODE_VERSION,
  PNPM_RUNTIME_BIN_PATH
} from '@/constants'
import { RuntimeHelper } from '@/helpers/runtime-helper'

import { createSetupStatus } from './setup-status'

const NODE_MODULES_PATH = path.join(process.cwd(), 'node_modules')
const NATIVE_NODE_MODULE_REBUILD_PACKAGES = [
  'better-sqlite3'
]
const STAMP_FILE_PATH = path.join(
  CACHE_PATH,
  'setup',
  '.last-native-node-modules-rebuild'
)

function getPackageManifestPath(packageName) {
  return path.join(NODE_MODULES_PATH, packageName, 'package.json')
}

function getInstalledRebuildPackages() {
  return NATIVE_NODE_MODULE_REBUILD_PACKAGES.filter((packageName) =>
    fs.existsSync(getPackageManifestPath(packageName))
  )
}

async function isRebuildCurrent(packageNames) {
  if (!fs.existsSync(STAMP_FILE_PATH)) {
    return false
  }

  const stampValue = (await fs.promises.readFile(STAMP_FILE_PATH, 'utf8')).trim()

  if (stampValue !== NODE_VERSION) {
    return false
  }

  const stampStat = await fs.promises.stat(STAMP_FILE_PATH)

  for (const packageName of packageNames) {
    const packageManifestStat = await fs.promises.stat(
      getPackageManifestPath(packageName)
    )

    if (packageManifestStat.mtimeMs > stampStat.mtimeMs) {
      return false
    }
  }

  return true
}

/**
 * Rebuild native modules that must match Leon's managed Node.js ABI.
 */
export default async function setupNativeNodeModules() {
  if (!fs.existsSync(NODE_MODULES_PATH)) {
    return
  }

  const installedPackages = getInstalledRebuildPackages()

  if (installedPackages.length === 0) {
    return
  }

  const status = createSetupStatus('Rebuilding native Node.js modules...').start()

  if (await isRebuildCurrent(installedPackages)) {
    status.succeed('Native Node.js modules: up-to-date')

    return
  }

  await execa(PNPM_RUNTIME_BIN_PATH, [
      'rebuild',
      ...installedPackages
    ], {
      cwd: process.cwd(),
      env: RuntimeHelper.getManagedNodeEnvironment()
    })

  await fs.promises.mkdir(path.dirname(STAMP_FILE_PATH), { recursive: true })
  await fs.promises.writeFile(STAMP_FILE_PATH, NODE_VERSION)

  status.succeed('Native Node.js modules: ready')
}
