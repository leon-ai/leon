import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'

import {
  PNPM_RUNTIME_BIN_PATH,
  PYTHON_RUNTIME_BIN_PATH,
  UV_RUNTIME_BIN_PATH
} from '@/constants'
import { RuntimeHelper } from '@/helpers/runtime-helper'

import {
  getProjectVenvPythonPath,
  getPyprojectDependencies
} from './setup-python-project-env'

const PACKAGE_JSON_FILE_NAME = 'package.json'
const PYPROJECT_FILE_NAME = 'pyproject.toml'
const SYNC_STAMP_FILE_NAME = '.last-source-deps-sync'
const NODE_MODULES_DIR_NAME = 'node_modules'
const VENV_DIR_NAME = '.venv'

const isFileEmpty = async (filePath) => {
  const content = await fs.promises.readFile(filePath, 'utf8')

  return content.trim() === ''
}

const getSyncStampPath = (sourcePath) => {
  return path.join(sourcePath, SYNC_STAMP_FILE_NAME)
}

const isSyncCurrent = async (manifestPath, stampPath, dependencyPath) => {
  if (
    !fs.existsSync(stampPath) ||
    !fs.existsSync(manifestPath) ||
    !fs.existsSync(dependencyPath)
  ) {
    return false
  }

  const [manifestStat, stampStat] = await Promise.all([
    fs.promises.stat(manifestPath),
    fs.promises.stat(stampPath)
  ])

  return manifestStat.mtimeMs <= stampStat.mtimeMs
}

const markSourceDependenciesAsSynced = async (sourcePath) => {
  await fs.promises.writeFile(getSyncStampPath(sourcePath), `${Date.now()}`)
}

/**
 * Sync Node.js dependencies next to the source that declares them.
 */
export const syncNodejsSourceDependencies = async (sourcePath) => {
  const packageJSONPath = path.join(sourcePath, PACKAGE_JSON_FILE_NAME)
  const nodeModulesPath = path.join(sourcePath, NODE_MODULES_DIR_NAME)
  const stampPath = getSyncStampPath(sourcePath)

  if (!fs.existsSync(packageJSONPath) || (await isFileEmpty(packageJSONPath))) {
    return
  }

  if (await isSyncCurrent(packageJSONPath, stampPath, nodeModulesPath)) {
    return
  }

  await fs.promises.rm(nodeModulesPath, { recursive: true, force: true })

  await execa(PNPM_RUNTIME_BIN_PATH, [
      'install',
      '--ignore-workspace',
      '--lockfile=false'
    ], {
      cwd: sourcePath,
      env: RuntimeHelper.getManagedNodeEnvironment()
    })

  await markSourceDependenciesAsSynced(sourcePath)
}

/**
 * Sync Python dependencies into a .venv next to the source that declares them.
 */
export const syncPythonSourceDependencies = async (sourcePath) => {
  const manifestPath = path.join(sourcePath, PYPROJECT_FILE_NAME)
  const venvPath = path.join(sourcePath, VENV_DIR_NAME)
  const stampPath = getSyncStampPath(sourcePath)

  if (!fs.existsSync(manifestPath)) {
    return
  }

  if (
    await isSyncCurrent(
      manifestPath,
      stampPath,
      getProjectVenvPythonPath(sourcePath)
    )
  ) {
    return
  }

  const dependencies = await getPyprojectDependencies(sourcePath)

  await fs.promises.rm(venvPath, { recursive: true, force: true })
  await execa(UV_RUNTIME_BIN_PATH, [
      'venv',
      '--python',
      PYTHON_RUNTIME_BIN_PATH,
      venvPath
    ], { cwd: sourcePath })

  if (dependencies.length > 0) {
    await execa(UV_RUNTIME_BIN_PATH, [
        'pip',
        'install',
        '--python',
        getProjectVenvPythonPath(sourcePath),
        ...dependencies
      ], { cwd: sourcePath })
  }

  await markSourceDependenciesAsSynced(sourcePath)
}
