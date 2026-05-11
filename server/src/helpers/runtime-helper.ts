import fs from 'node:fs'
import path from 'node:path'

import { LEON_HOME_PATH } from '@/leon-roots'
import { SystemHelper } from '@/helpers/system-helper'

export class RuntimeHelper {
  /**
   * Resolve Leon-managed runtime binaries from the local `bin/` directory first.
   */
  private static readonly binPath = path.join(LEON_HOME_PATH, 'bin')

  /**
   * Pick the first runtime candidate that already exists on disk.
   */
  private static firstExistingPath(candidates: string[]): string | null {
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    return null
  }

  /**
   * Resolve a runtime executable from an explicit env override, Leon-managed
   * portable binaries, then a system fallback.
   */
  private static resolveExecutable(
    envVarName: string,
    candidates: string[],
    fallback: string
  ): string {
    const envValue = process.env[envVarName]?.trim()

    if (envValue) {
      return envValue
    }

    return this.firstExistingPath(candidates) || fallback
  }

  /**
   * Quote shell arguments because several runtime paths can contain spaces,
   * especially in desktop install locations.
   */
  private static escapeShellArgument(value: string): string {
    return `"${value.replaceAll('"', '\\"')}"`
  }

  private static buildManagedRuntimeShellFunction(
    name: string,
    executablePath: string
  ): string {
    const escapedExecutablePath = this.escapeShellArgument(executablePath)

    return [
      `${name}() {`,
      `  if [ -x ${escapedExecutablePath} ]; then`,
      `    ${escapedExecutablePath} "$@"`,
      '  else',
      `    command ${name} "$@"`,
      '  fi',
      '}'
    ].join('\n')
  }

  /**
   * Resolve the Node.js runtime binary Leon should use.
   */
  public static getNodeBinPath(): string {
    return this.resolveExecutable(
      'LEON_NODE_PATH',
      [
        path.join(
          this.binPath,
          'node',
          SystemHelper.isWindows() ? 'node.exe' : 'node'
        ),
        path.join(
          this.binPath,
          'node',
          'bin',
          SystemHelper.isWindows() ? 'node.exe' : 'node'
        )
      ],
      process.execPath
    )
  }

  /**
   * Resolve the pnpm binary Leon should use for dependency management.
   */
  public static getPNPMBinPath(): string {
    return this.resolveExecutable(
      'LEON_PNPM_PATH',
      [
        path.join(
          this.binPath,
          'pnpm',
          SystemHelper.isWindows() ? 'pnpm.exe' : 'pnpm'
        ),
        path.join(
          this.binPath,
          'pnpm',
          SystemHelper.isWindows() ? 'pnpm.cmd' : 'pnpm'
        ),
        path.join(
          this.binPath,
          'pnpm',
          'bin',
          SystemHelper.isWindows() ? 'pnpm.cmd' : 'pnpm'
        )
      ],
      'pnpm'
    )
  }

  /**
   * Ensure pnpm lifecycle scripts use Leon's managed Node.js runtime instead of
   * whichever `node` happens to be first on the user's PATH.
   */
  public static getManagedNodeEnvironment(
    env: NodeJS.ProcessEnv = process.env
  ): NodeJS.ProcessEnv {
    const nodeBinPath = this.getNodeBinPath()
    const nodeDirPath = path.dirname(nodeBinPath)
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ||
      'PATH'
    const currentPathValue = env[pathKey] || ''
    const currentPathEntries = currentPathValue
      .split(path.delimiter)
      .filter(Boolean)
    const nextPathValue = currentPathEntries.includes(nodeDirPath)
      ? currentPathValue
      : [nodeDirPath, ...currentPathEntries].join(path.delimiter)

    return {
      ...env,
      [pathKey]: nextPathValue,
      NODE: nodeBinPath,
      npm_config_node_execpath: nodeBinPath,
      npm_node_execpath: nodeBinPath
    }
  }

  /**
   * Render shell functions that make temp scripts call Leon-managed runtimes
   * explicitly instead of resolving bare commands through PATH.
   */
  public static buildManagedRuntimeShellFunctions(): string {
    const functions: Array<[string, string]> = [
      ['node', this.getNodeBinPath()],
      ['python', this.getPythonBinPath()],
      ['python3', this.getPythonBinPath()],
      ['pnpm', this.getPNPMBinPath()],
      ['uv', this.getUVBinPath()]
    ]

    return functions
      .map(([name, executablePath]) =>
        this.buildManagedRuntimeShellFunction(name, executablePath)
      )
      .join('\n\n')
  }

  /**
   * Resolve the Python binary Leon should use for bridges and skills.
   */
  public static getPythonBinPath(): string {
    const envValue = process.env['LEON_PYTHON_PATH']?.trim()

    if (envValue) {
      return envValue
    }

    const managedCandidates = [
      path.join(
        this.binPath,
        'python',
        SystemHelper.isWindows() ? 'python.exe' : 'python'
      ),
      path.join(this.binPath, 'python', 'bin', 'python'),
      path.join(this.binPath, 'python', 'bin', 'python3')
    ]
    const expectedManagedPythonBinPath = SystemHelper.isWindows()
      ? path.join(this.binPath, 'python', 'python.exe')
      : path.join(this.binPath, 'python', 'bin', 'python')

    return (
      this.firstExistingPath(managedCandidates) || expectedManagedPythonBinPath
    )
  }

  /**
   * Resolve the uv binary Leon should use for Python dependency management.
   */
  public static getUVBinPath(): string {
    const envValue = process.env['LEON_UV_PATH']?.trim()

    if (envValue) {
      return envValue
    }

    const managedCandidates = [
      path.join(
        this.binPath,
        'uv',
        SystemHelper.isWindows() ? 'uv.exe' : 'uv'
      ),
      path.join(
        this.binPath,
        'uv',
        'bin',
        SystemHelper.isWindows() ? 'uv.exe' : 'uv'
      )
    ]
    const expectedManagedUVBinPath = SystemHelper.isWindows()
      ? path.join(this.binPath, 'uv', 'uv.exe')
      : path.join(this.binPath, 'uv', 'uv')

    return this.firstExistingPath(managedCandidates) || expectedManagedUVBinPath
  }

  /**
   * Prefer a project-local virtual environment when available so bridge and TCP
   * server commands keep using the Python environment they were installed into.
   */
  public static resolveProjectPythonBinPath(projectRootPath: string): string {
    const venvBinPath = path.join(projectRootPath, '.venv')
    const venvCandidates = [
      path.join(
        venvBinPath,
        SystemHelper.isWindows() ? 'Scripts' : 'bin',
        SystemHelper.isWindows() ? 'python.exe' : 'python'
      ),
      path.join(
        venvBinPath,
        SystemHelper.isWindows() ? 'Scripts' : 'bin',
        'python3'
      )
    ]

    return this.firstExistingPath(venvCandidates) || this.getPythonBinPath()
  }

  /**
   * Build a shell-safe command string for execa/spawn call sites that currently
   * rely on `shell: true`.
   */
  public static buildShellCommand(
    executablePath: string,
    args: string[] = []
  ): string {
    return [executablePath, ...args].map((arg) =>
      this.escapeShellArgument(arg)
    ).join(' ')
  }
}
