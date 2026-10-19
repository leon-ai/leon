import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import execa from 'execa'

import {
  CODEBASE_PATH,
  PYTHON_RUNTIME_BIN_PATH,
  UV_RUNTIME_BIN_PATH
} from '@/constants'
import { SystemHelper } from '@/helpers/system-helper'

import { createSetupStatus } from './setup-status'

const PYPROJECT_FILE_NAME = 'pyproject.toml'
const UV_CONFIG_FILE_NAME = 'uv.toml'

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

  await execa(UV_RUNTIME_BIN_PATH, [
      'pip',
      'install',
      '--config-file',
      path.join(CODEBASE_PATH, UV_CONFIG_FILE_NAME),
      '--python',
      getProjectVenvPythonPath(projectPath),
      ...dependencies
    ], { cwd: projectPath, stdio })
}

/**
 * Create or refresh a project-local `.venv` and install dependencies declared
 * in `pyproject.toml` through Leon's managed `uv` and Python runtimes.
 */
export async function setupPythonProjectEnv({
  name,
  projectPath,
  stampFileName
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

  await installPythonProjectDependencies(projectPath, dependencies)

  await fs.promises.writeFile(stampPath, fingerprint)

  status.succeed(`${name}: ready`)
}
