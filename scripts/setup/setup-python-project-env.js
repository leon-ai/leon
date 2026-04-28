import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'

import {
  PYTHON_RUNTIME_BIN_PATH,
  UV_RUNTIME_BIN_PATH
} from '@/constants'
import { SystemHelper } from '@/helpers/system-helper'

import { createSetupStatus } from './setup-status'

const PYPROJECT_FILE_NAME = 'pyproject.toml'

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
 * Check whether a project dependency sync stamp is newer than its manifest.
 */
async function isSyncCurrent(projectPath, stampFileName) {
  const pyprojectPath = path.join(projectPath, PYPROJECT_FILE_NAME)
  const stampPath = path.join(projectPath, stampFileName)

  if (
    !fs.existsSync(pyprojectPath) ||
    !fs.existsSync(stampPath) ||
    !fs.existsSync(getProjectVenvPythonPath(projectPath))
  ) {
    return false
  }

  const [manifestStat, stampStat] = await Promise.all([
    fs.promises.stat(pyprojectPath),
    fs.promises.stat(stampPath)
  ])

  return manifestStat.mtimeMs <= stampStat.mtimeMs
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

  if (await isSyncCurrent(projectPath, stampFileName)) {
    status.succeed(`${name}: up-to-date`)

    return
  }

  await ensurePythonRuntimeAvailable(name)
  await ensureUVRuntimeAvailable(name)

  const dependencies = await getPyprojectDependencies(projectPath)

  await fs.promises.rm(venvPath, { recursive: true, force: true })

  await execa(UV_RUNTIME_BIN_PATH, [
      'venv',
      '--python',
      PYTHON_RUNTIME_BIN_PATH,
      venvPath
    ], { cwd: projectPath })

  if (dependencies.length > 0) {
    await execa(UV_RUNTIME_BIN_PATH, [
        'pip',
        'install',
        '--python',
        getProjectVenvPythonPath(projectPath),
        ...dependencies
      ], { cwd: projectPath })
  }

  await fs.promises.writeFile(stampPath, `${Date.now()}`)

  status.succeed(`${name}: ready`)
}
