import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

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
const PNPM_HOOK_FILE_NAME = '.pnpmfile.mjs'
const PYPROJECT_FILE_NAME = 'pyproject.toml'
const SYNC_STAMP_FILE_NAME = '.last-source-deps-sync'
const NODE_MODULES_DIR_NAME = 'node_modules'
const VENV_DIR_NAME = '.venv'
const PNPM_POLICY_ENV_KEYS = {
  allowBuilds: 'pnpm_config_allow_builds',
  dangerouslyAllowAllBuilds: 'pnpm_config_dangerously_allow_all_builds',
  sideEffectsCache: 'pnpm_config_side_effects_cache',
  overrides: 'pnpm_config_overrides',
  minimumReleaseAgeExclude: 'pnpm_config_minimum_release_age_exclude'
}

const isFileEmpty = async (filePath) => {
  const content = await fs.promises.readFile(filePath, 'utf8')

  return content.trim() === ''
}

const getSyncStampPath = (sourcePath) => {
  return path.join(sourcePath, SYNC_STAMP_FILE_NAME)
}

const isSyncCurrent = async (fingerprint, stampPath, dependencyPath) => {
  if (
    !fs.existsSync(stampPath) ||
    !fs.existsSync(dependencyPath)
  ) {
    return false
  }

  return await fs.promises.readFile(stampPath, 'utf8') === fingerprint
}

/**
 * Detect manifest, policy and hook edits even when timestamps have not advanced.
 */
const getSyncFingerprint = async (sourcePath, configPaths) => {
  const hash = createHash('sha256').update(sourcePath)

  for (const configPath of configPaths) {
    hash.update('\0').update(await fs.promises.readFile(configPath))
  }

  return hash.digest('hex')
}

/**
 * Combine shared build policy with source-owned configuration before installation.
 */
const getNodejsInstallEnvironment = async (workspacePath, hookPath, fingerprint) => {
  let config = YAML.parse(await fs.promises.readFile(workspacePath, 'utf8')) || {}
  const environment = RuntimeHelper.getManagedNodeEnvironment()

  if (fs.existsSync(hookPath)) {
    // Source configuration must be in place before pnpm discovers projects, so
    // a nested install cannot adopt its ancestor workspace's dependencies.
    const hookURL = pathToFileURL(hookPath)

    hookURL.searchParams.set('configuration', fingerprint)

    const { hooks } = await import(hookURL.href)

    if (hooks?.updateConfig) {
      config = await hooks.updateConfig(config)
    }
  }

  // JSON preserves structured permissions and dependency resolution rules.
  for (const [setting, environmentKey] of Object.entries(PNPM_POLICY_ENV_KEYS)) {
    if (Object.hasOwn(config, setting)) {
      environment[environmentKey] = JSON.stringify(config[setting])
    }
  }

  return environment
}

const markSourceDependenciesAsSynced = async (sourcePath, fingerprint) => {
  await fs.promises.writeFile(getSyncStampPath(sourcePath), fingerprint)
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
 * Notify onInstall before an installation and optionally stream installer output via stdio.
 */
export const syncNodejsSourceDependencies = async (
  sourcePath,
  { onInstall, stdio = 'pipe' } = {}
) => {
  sourcePath = path.resolve(sourcePath)

  const packageJSONPath = path.join(sourcePath, PACKAGE_JSON_FILE_NAME)
  const nodeModulesPath = path.join(sourcePath, NODE_MODULES_DIR_NAME)
  const stampPath = getSyncStampPath(sourcePath)
  const workspacePath = path.join(CODEBASE_PATH, PNPM_WORKSPACE_FILE_NAME)
  const hookPath = path.join(sourcePath, PNPM_HOOK_FILE_NAME)
  const configPaths = [
    packageJSONPath,
    workspacePath,
    ...(fs.existsSync(hookPath) ? [hookPath] : [])
  ]

  if (!fs.existsSync(packageJSONPath) || (await isFileEmpty(packageJSONPath))) {
    return
  }

  const manifest = JSON.parse(await fs.promises.readFile(packageJSONPath, 'utf8'))
  const fingerprint = await getSyncFingerprint(sourcePath, configPaths)

  if (
    await isSyncCurrent(fingerprint, stampPath, nodeModulesPath) &&
    getMissingNodejsDependencies(manifest, nodeModulesPath).length === 0
  ) {
    return
  }

  const environment = await getNodejsInstallEnvironment(workspacePath, hookPath, fingerprint)

  onInstall?.()

  // A failed repair must not leave an earlier success stamp behind.
  await fs.promises.rm(stampPath, { force: true })
  await fs.promises.rm(nodeModulesPath, { recursive: true, force: true })

  const installArgs = [
    'install',
    '--ignore-workspace',
    '--lockfile-dir',
    sourcePath,
    '--lockfile=false'
  ]

  await execa(PNPM_RUNTIME_BIN_PATH, installArgs, {
    cwd: sourcePath,
    env: environment,
    stdio
  })

  const missingDependencies = getMissingNodejsDependencies(manifest, nodeModulesPath)
  if (missingDependencies.length > 0) {
    throw new Error(`Dependency installation in "${sourcePath}" did not link: ${missingDependencies.join(', ')}`)
  }

  await markSourceDependenciesAsSynced(sourcePath, fingerprint)
}

/**
 * Sync Python dependencies into a .venv next to the source that declares them.
 * Notify onInstall before an installation and optionally stream installer output via stdio.
 */
export const syncPythonSourceDependencies = async (
  sourcePath,
  { onInstall, stdio = 'pipe' } = {}
) => {
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

  onInstall?.()

  await fs.promises.rm(stampPath, { force: true })
  await fs.promises.rm(venvPath, { recursive: true, force: true })
  await execa(UV_RUNTIME_BIN_PATH, [
      'venv',
      '--python',
      PYTHON_RUNTIME_BIN_PATH,
      venvPath
    ], { cwd: sourcePath, stdio })

  if (dependencies.length > 0) {
    await execa(UV_RUNTIME_BIN_PATH, [
        'pip',
        'install',
        '--python',
        getProjectVenvPythonPath(sourcePath),
        ...dependencies
      ], { cwd: sourcePath, stdio })
  }

  await fs.promises.writeFile(stampPath, path.resolve(sourcePath))
}
