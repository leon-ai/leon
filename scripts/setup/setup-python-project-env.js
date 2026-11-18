import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'

import { execa } from 'execa'
import {
  CHINA_PYPI_INDEX,
  PUBLIC_PYPI_INDEX,
  getRegionalInstallerEnvironment
} from '../../bridges/runtime/nodejs/download-region.js'

import {
  CODEBASE_PATH,
  PYTHON_RUNTIME_BIN_PATH,
  UV_RUNTIME_BIN_PATH
} from '@/constants'
import { SystemHelper } from '@/helpers/system-helper'
import { LogHelper } from '@/helpers/log-helper'

import { createSetupStatus } from './setup-status'

const PYPROJECT_FILE_NAME = 'pyproject.toml'
const UV_CONFIG_FILE_NAME = 'uv.toml'
const MIRROR_HTTP_TIMEOUT_SECONDS = 15
const PYTHON_INDEX_CONFIGURATION_PATTERN = /^\s*(?:(?:default-index|index-url|extra-index-url|index-strategy|index)\s*=|\[\[?(?:tool\.uv\.)?index(?:\]|\.))/m

/**
 * Apply regional defaults only when project and shared policy leave indexes unset.
 */
async function getPythonInstallEnvironment(projectPath) {
  // An explicitly configured project or company index takes precedence over
  // regional defaults, just as source-scoped npm registries do.
  for (const filename of [
    process.env.UV_CONFIG_FILE,
    path.join(process.env.APPDATA || process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'uv', UV_CONFIG_FILE_NAME),
    ...(process.env.XDG_CONFIG_DIRS || '/etc').split(path.delimiter)
      .map((directory) => path.join(directory, 'uv', UV_CONFIG_FILE_NAME)),
    path.join(CODEBASE_PATH, UV_CONFIG_FILE_NAME),
    path.join(projectPath, UV_CONFIG_FILE_NAME),
    path.join(projectPath, PYPROJECT_FILE_NAME)
  ]) {
    if (!filename) {
      continue
    }

    const content = await fs.promises.readFile(filename, 'utf8').catch(() => '')

    if (PYTHON_INDEX_CONFIGURATION_PATTERN.test(content)) {
      return getRegionalInstallerEnvironment(process.env, { python: false })
    }
  }

  return getRegionalInstallerEnvironment()
}

/**
 * Detect whether a command failed to spawn because the executable was missing.
 */
function isExecutableMissingError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

/**
 * Make Python runtime resolution failures actionable during setup.
 */
async function ensurePythonRuntimeAvailable(name) {
  try {
    await execa(PYTHON_RUNTIME_BIN_PATH, ['--version'])
  } catch (error) {
    if (!isExecutableMissingError(error)) {
      throw error
    }

    throw new Error(
      `${name}: unable to resolve Leon's managed Python runtime at "${PYTHON_RUNTIME_BIN_PATH}". Make sure the managed Python setup completed successfully, or set \`LEON_PYTHON_PATH\` to an explicit Python executable if you intentionally want to override it.`,
      { cause: error }
    )
  }
}

/**
 * Make uv runtime resolution failures actionable during setup.
 */
async function ensureUVRuntimeAvailable(name) {
  try {
    await execa(UV_RUNTIME_BIN_PATH, ['--version'])
  } catch (error) {
    if (!isExecutableMissingError(error)) {
      throw error
    }

    throw new Error(
      `${name}: unable to resolve Leon's managed uv runtime at "${UV_RUNTIME_BIN_PATH}". Make sure the managed uv setup completed successfully, or set \`LEON_UV_PATH\` to an explicit uv executable if you intentionally want to override it.`,
      { cause: error }
    )
  }
}

/**
 * Read the dependency list from a Python project's `pyproject.toml` using the
 * managed Python runtime and the standard-library `tomllib` parser.
 */
export async function getPyprojectDependencies(projectPath) {
  const pyprojectPath = path.join(projectPath, PYPROJECT_FILE_NAME)

  if (!fs.existsSync(pyprojectPath)) {
    return []
  }

  const readerScript = [
    'import json',
    'import sys',
    'import tomllib',
    'from pathlib import Path',
    'data = tomllib.loads(Path(sys.argv[1]).read_text())',
    'deps = data.get("project", {}).get("dependencies", [])',
    'print(json.dumps(deps))'
  ].join('; ')

  const result = await execa(PYTHON_RUNTIME_BIN_PATH, [
      '-c',
      readerScript,
      pyprojectPath
    ])

  return JSON.parse(result.stdout)
}

/**
 * Resolve the Python executable path inside a project-local `.venv`.
 */
export function getProjectVenvPythonPath(projectPath) {
  return path.join(
    projectPath,
    '.venv',
    SystemHelper.isWindows() ? 'Scripts' : 'bin',
    SystemHelper.isWindows() ? 'python.exe' : 'python'
  )
}

/**
 * Bind installed dependencies to their source location, manifest and shared policy.
 */
export async function getPythonProjectSyncFingerprint(projectPath) {
  const hash = createHash('sha256').update(path.resolve(projectPath))

  for (const configPath of [
    path.join(projectPath, PYPROJECT_FILE_NAME),
    path.join(CODEBASE_PATH, UV_CONFIG_FILE_NAME)
  ]) {
    hash.update('\0').update(await fs.promises.readFile(configPath))
  }

  return hash.digest('hex')
}

/**
 * Check whether the environment matches its source location, manifest and policy.
 */
export async function isPythonProjectSyncCurrent(projectPath, stampFileName) {
  const pyprojectPath = path.join(projectPath, PYPROJECT_FILE_NAME)
  const stampPath = path.join(projectPath, stampFileName)

  if (
    !fs.existsSync(pyprojectPath) ||
    !fs.existsSync(stampPath) ||
    !fs.existsSync(getProjectVenvPythonPath(projectPath))
  ) {
    return false
  }

  // Console-script shebangs contain absolute paths, so moved environments
  // must be rebuilt even when their Python symlink still resolves.
  return (
    await fs.promises.readFile(stampPath, 'utf8') ===
    await getPythonProjectSyncFingerprint(projectPath)
  )
}

/**
 * Apply the codebase's uv policy even to independently installed profile sources.
 */
export async function installPythonProjectDependencies(
  projectPath,
  dependencies,
  { stdio = 'pipe' } = {}
) {
  if (dependencies.length === 0) {
    return
  }

  const environment = await getPythonInstallEnvironment(projectPath)
  const usesAutomaticMirror = (
    !process.env.UV_INDEX &&
    environment.UV_INDEX === CHINA_PYPI_INDEX &&
    environment.UV_DEFAULT_INDEX === PUBLIC_PYPI_INDEX
  )
  const installArguments = [
    'pip',
    'install',
    '--config-file',
    path.join(CODEBASE_PATH, UV_CONFIG_FILE_NAME),
    '--python',
    getProjectVenvPythonPath(projectPath),
    ...dependencies
  ]

  try {
    await execa(UV_RUNTIME_BIN_PATH, installArguments, {
      cwd: projectPath,
      stdio,
      env: usesAutomaticMirror ? {
        ...environment,
        UV_HTTP_TIMEOUT: environment.UV_HTTP_TIMEOUT || String(MIRROR_HTTP_TIMEOUT_SECONDS),
        UV_HTTP_RETRIES: environment.UV_HTTP_RETRIES || '0'
      } : environment
    })
  } catch (error) {
    if (!usesAutomaticMirror || error.exitCode === undefined || error.isCanceled || error.signal) {
      throw error
    }

    // uv's index search handles missing metadata, but not every transport or
    // artifact failure. Retry once against PyPI with the same pins and policy.
    LogHelper.warning('Python mirror installation failed; retrying once with the original PyPI index')

    const fallbackEnvironment = { ...environment }

    delete fallbackEnvironment.UV_INDEX
    delete fallbackEnvironment.UV_INDEX_STRATEGY

    await execa(UV_RUNTIME_BIN_PATH, installArguments, {
      cwd: projectPath,
      stdio,
      env: fallbackEnvironment
    })
  }
}

/**
 * Create or refresh a project-local `.venv` and install dependencies declared
 * in `pyproject.toml` through Leon's managed `uv` and Python runtimes.
 */
export async function setupPythonProjectEnv({
  name,
  projectPath,
  stampFileName,
  prebuiltPackagesPath
}) {
  const status = createSetupStatus(`Setting up ${name} dependencies...`).start()
  const pyprojectPath = path.join(projectPath, PYPROJECT_FILE_NAME)
  const stampPath = path.join(projectPath, stampFileName)
  const venvPath = path.join(projectPath, '.venv')

  if (!fs.existsSync(pyprojectPath)) {
    status.pause()
    return
  }

  if (await isPythonProjectSyncCurrent(projectPath, stampFileName)) {
    status.succeed(`${name}: up-to-date`)

    return
  }

  await ensurePythonRuntimeAvailable(name)
  await ensureUVRuntimeAvailable(name)

  const dependencies = await getPyprojectDependencies(projectPath)
  const fingerprint = await getPythonProjectSyncFingerprint(projectPath)

  await fs.promises.rm(stampPath, { force: true })
  await fs.promises.rm(venvPath, { recursive: true, force: true })

  await execa(UV_RUNTIME_BIN_PATH, [
      'venv',
      '--python',
      PYTHON_RUNTIME_BIN_PATH,
      venvPath
    ], { cwd: projectPath })

  if (prebuiltPackagesPath) {
    // Build workers resolve dependencies; owners only bind them to a local venv.
    const result = await execa(getProjectVenvPythonPath(projectPath), [
      '-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'
    ])
    await fs.promises.cp(prebuiltPackagesPath, result.stdout.trim(), { recursive: true })
  } else {
    await installPythonProjectDependencies(projectPath, dependencies)
  }

  await fs.promises.writeFile(stampPath, fingerprint)

  status.succeed(`${name}: ready`)
}
