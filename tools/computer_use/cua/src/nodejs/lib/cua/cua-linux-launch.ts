import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import type { ComputerUseDriver, CuaToolResult } from '../types'
import { asRecord, hasCuaError, hasText, parseJsonRecord } from '../utils'

const COMMAND_SEPARATOR = /\s+/
// Cua 0.28 inherits SDK call-scoped pipes. GTK can die when those pipes close.
// Positional arguments preserve argv and leave Cua's launch admission intact.
const LAUNCH_SCRIPT = 'log=$1; shift; exec "$@" </dev/null >>"$log" 2>&1'

/**
 * Gives locally launched Linux apps durable streams, independent of an SDK call.
 */
export class CuaLinuxLaunchAdapter implements ComputerUseDriver {
  public readonly setAgentCursorEnabled?: NonNullable<ComputerUseDriver['setAgentCursorEnabled']>

  public constructor(
    private readonly driver: ComputerUseDriver,
    private readonly artifactDirectory: string
  ) {
    this.setAgentCursorEnabled = driver.setAgentCursorEnabled?.bind(driver)
  }

  public isAvailable(): boolean { return this.driver.isAvailable() }
  public listToolsJson(): Promise<string> { return this.driver.listToolsJson() }
  public shutdown(): Promise<void> { return this.driver.shutdown() }
  public uniffiDestroy(): void { this.driver.uniffiDestroy() }

  public async callTool(name: string, argumentsJson: string): Promise<CuaToolResult> {
    const args = parseJsonRecord(argumentsJson) || {}
    // URL handlers and non-launch calls retain the native implementation.
    if (name !== 'launch_app' || (Array.isArray(args['urls']) && args['urls'].length)) {
      return this.driver.callTool(name, argumentsJson)
    }
    let command = args['launch_path']
    if (!hasText(command) && hasText(args['name'])) {
      const appsResult = await this.driver.callTool('list_apps', '{}')
      const apps = parseJsonRecord(appsResult.structuredJson)?.['apps']
      if (hasCuaError(appsResult) || !Array.isArray(apps)) return this.driver.callTool(name, argumentsJson)
      const query = args['name'].toLocaleLowerCase()
      const installed = apps.map(asRecord).filter((app) => app && hasText(app['launch_path']))
      const exact = installed.filter((app) => [app!['name'], app!['bundle_id'],
        path.basename(String(app!['launch_path']).split(COMMAND_SEPARATOR)[0]!)
      ].some((value) => typeof value === 'string' && value.toLocaleLowerCase() === query))
      const matches = exact.length ? exact : installed.filter((app) =>
        String(app!['name']).toLocaleLowerCase().includes(query))
      if (matches.length === 1) command = matches[0]!['launch_path']
    }
    // Keep native resolution/refusals for unknown commands and ambiguous names.
    if (!hasText(command)) return this.driver.callTool(name, argumentsJson)
    const extra = args['additional_arguments'] ?? []
    if (!Array.isArray(extra) || extra.some((arg) => typeof arg !== 'string')) {
      return this.driver.callTool(name, argumentsJson)
    }
    await fs.mkdir(this.artifactDirectory, { recursive: true })
    const logPath = path.join(this.artifactDirectory, `${randomUUID()}-application.log`)
    const log = await fs.open(logPath, 'wx', 0o600)
    await log.close()
    const result = await this.driver.callTool(name, JSON.stringify({
      ...args,
      launch_path: '/bin/sh',
      additional_arguments: ['-c', LAUNCH_SCRIPT, 'leon-app', logPath,
        // Match the native Exec tokenization; do not reinterpret it as shell code.
        ...command.trim().split(COMMAND_SEPARATOR), ...extra]
    }))
    const data = parseJsonRecord(result.structuredJson)
    if (data && !hasCuaError(result)) {
      result.structuredJson = JSON.stringify({ ...data,
        name: hasText(args['name']) ? args['name'] : command,
        launch_log: logPath
      })
    }
    return result
  }
}
