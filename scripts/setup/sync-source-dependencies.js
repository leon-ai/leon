import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'
import YAML from 'yaml'

import {
  CODEBASE_PATH,
  PNPM_RUNTIME_BIN_PATH,
  PYTHON_RUNTIME_BIN_PATH,
  UV_RUNTIME_BIN_PATH
} from '@/constants'
import { RuntimeHelper } from '@/helpers/runtime-helper'

import {
  getProjectVenvPythonPath,
  getPyprojectDependencies,
  isPythonProjectSyncCurrent
} from './setup-python-project-env'

const PACKAGE_JSON_FILE_NAME = 'package.json'
const PNPM_WORKSPACE_FILE_NAME = 'pnpm-workspace.yaml'
const PYPROJECT_FILE_NAME = 'pyproject.toml'
const SYNC_STAMP_FILE_NAME = '.last-source-deps-sync'
const NODE_MODULES_DIR_NAME = 'node_modules'
const VENV_DIR_NAME = '.venv'
const PNPM_BUILD_ENV_KEYS = {
  allowBuilds: 'pnpm_config_allow_builds',
  dangerouslyAllowAllBuilds: 'pnpm_config_dangerously_allow_all_builds',
  sideEffectsCache: 'pnpm_config_side_effects_cache'
}

const isFileEmpty = async (filePath) => {
  const content = await fs.promises.readFile(filePath, 'utf8')

  return content.trim() === ''
}

const getSyncStampPath = (sourcePath) => {
  return path.join(sourcePath, SYNC_STAMP_FILE_NAME)
}

const isSyncCurrent = async (configPaths, stampPath, dependencyPath) => {
  if (
    !fs.existsSync(stampPath) ||
    configPaths.some((configPath) => !fs.existsSync(configPath)) ||
    !fs.existsSync(dependencyPath)
  ) {
    return false
  }

  const [configStats, stampStat] = await Promise.all([
    Promise.all(configPaths.map((configPath) => fs.promises.stat(configPath))),
    fs.promises.stat(stampPath)
  ])

  return configStats.every((configStat) => configStat.mtimeMs <= stampStat.mtimeMs)
}

/**
 * Carry root build permissions into standalone installs, including profile sources.
 */
const getNodejsBuildEnvironment = async (workspacePath) => {
  const config = YAML.parse(await fs.promises.readFile(workspacePath, 'utf8')) || {}
  const environment = RuntimeHelper.getManagedNodeEnvironment()

  // JSON preserves structured allowBuilds rules; CLI flags only handle scalars.
  for (const [setting, environmentKey] of Object.entries(PNPM_BUILD_ENV_KEYS)) {
    if (Object.hasOwn(config, setting)) {
      environment[environmentKey] = JSON.stringify(config[setting])
    }
  }

  return environment
}

const markSourceDependenciesAsSynced = async (sourcePath) => {
  await fs.promises.writeFile(getSyncStampPath(sourcePath), `${Date.now()}`)
}

/**
 * Check direct dependency links instead of trusting an install's exit code.
 */
const getMissingNodejsDependencies = (manifest, nodeModulesPath) => {
  // Optional dependencies may be intentionally absent on this platform.
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter((name) => !Object.hasOwn(manifest.optionalDependencies || {}, name))
    .filter((name) => !fs.existsSync(path.join(nodeModulesPath, name, PACKAGE_JSON_FILE_NAME)))
}

/**
 * Sync Node.js dependencies next to the source that declares them.
 */
export const syncNodejsSourceDependencies = async (sourcePath) => {
  const packageJSONPath = path.join(sourcePath, PACKAGE_JSON_FILE_NAME)
  const nodeModulesPath = path.join(sourcePath, NODE_MODULES_DIR_NAME)
  const stampPath = getSyncStampPath(sourcePath)
  const workspacePath = path.join(CODEBASE_PATH, PNPM_WORKSPACE_FILE_NAME)

  if (!fs.existsSync(packageJSONPath) || (await isFileEmpty(packageJSONPath))) {
    return
  }

  const manifest = JSON.parse(await fs.promises.readFile(packageJSONPath, 'utf8'))

  if (
    await isSyncCurrent([packageJSONPath, workspacePath], stampPath, nodeModulesPath) &&
    getMissingNodejsDependencies(manifest, nodeModulesPath).length === 0
  ) {
    return
  }

  const environment = await getNodejsBuildEnvironment(workspacePath)

  // A failed repair must not leave an earlier success stamp behind.
  await fs.promises.rm(stampPath, { force: true })
  await fs.promises.rm(nodeModulesPath, { recursive: true, force: true })

  const installArgs = [
    'install',
    // Keep dependencies beside their source without requiring nested workspaces.
    '--ignore-workspace',
    '--lockfile-dir',
    sourcePath,
    '--lockfile=false'
  ]

  await execa(PNPM_RUNTIME_BIN_PATH, installArgs, {
    cwd: sourcePath,
    env: environment
  })

  const missingDependencies = getMissingNodejsDependencies(manifest, nodeModulesPath)
  if (missingDependencies.length > 0) {
    throw new Error(`Dependency installation in "${sourcePath}" did not link: ${missingDependencies.join(', ')}`)
  }

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
    await isPythonProjectSyncCurrent(sourcePath, SYNC_STAMP_FILE_NAME)
  ) {
    return
  }

  const dependencies = await getPyprojectDependencies(sourcePath)

  await fs.promises.rm(stampPath, { force: true })
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

  await fs.promises.writeFile(stampPath, path.resolve(sourcePath))
}
