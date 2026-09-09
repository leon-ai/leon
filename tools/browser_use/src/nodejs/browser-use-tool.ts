import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import execa, { type ExecaChildProcess } from 'execa'

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PROFILE_SESSIONS_PATH } from '@bridge/constants'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { isWindows } from '@sdk/utils'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const MAX_PORT = 65_535
const REMOTE_DEBUGGING_SETTINGS_URL = 'chrome://inspect/#remote-debugging'

const COMMAND_TIMEOUT_MS = 60_000
const MAX_OUTPUT_BYTES = 1_048_576
const MAX_OUTPUT_PREVIEW_CHARACTERS = 16_000
const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const CLI_PATH = path.join(SOURCE_DIRECTORY, '.venv', isWindows() ? 'Scripts' : 'bin', isWindows() ? 'browser-use.exe' : 'browser-use')
const SCREENSHOT_MAX_DIMENSION = 1_800
const CLI_ENVIRONMENT = {
  BU_NAME: 'default', BU_BROWSER_ID: '', BU_AUTOSPAWN: '',
  BH_RECORD: '0', BH_TAB_MARKER: '0', BH_DOMAIN_SKILLS: '0',
  ANONYMIZED_TELEMETRY: 'false', PYTHONIOENCODING: 'utf-8'
}

enum BrowserSetupState {
  ConfigurationRequired = 'configuration_required',
  RemoteDebuggingRequired = 'remote_debugging_required',
  ConnectionUnavailable = 'connection_unavailable'
}

interface BrowserSetupFacts {
  settings_path?: string
  user_data_dir?: string
  settings_url?: string
  owner_steps: string[]
}

/**
 * Setup facts are returned to the agent so it can explain the next step naturally.
 */
class BrowserSetupRequiredError extends Error {
  /**
   * Keep machine-readable readiness separate from the LLM's owner-facing explanation.
   */
  public constructor(
    message: string,
    public readonly setupState: BrowserSetupState,
    public readonly setup: BrowserSetupFacts
  ) {
    super(message)
    this.name = 'BrowserSetupRequiredError'
  }
}

/**
 * Runs upstream's CLI while Leon retains planning, model calls, and tool logging.
 */
export class BrowserUseTool extends Tool {
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)
  private canceled = false
  private readonly running = new Set<ExecaChildProcess<string>>()

  public constructor() {
    super()
    this.settings = ToolkitConfig.loadToolSettings(this.toolkit, this.toolName)
    // Preserve the configured browser from the earlier comparison tool.
    if (!this.settings['cdp_endpoint'] && !this.settings['user_data_dir'] && existsSync(this.getSettingsPath('playwright'))) {
      this.settings = ToolkitConfig.loadToolSettings(this.toolkit, 'playwright')
    }
    this.checkRequiredSettings()
  }

  /**
   * Run a bounded script using the CLI's persistent browser connection.
   */
  public run(code: string): Promise<Record<string, unknown>> { return this.invoke('run', { code }) }

  /**
   * Inspect visible controls in an observed tab.
   */
  public inspect(tab_id: string, selector?: string, offset?: number, limit?: number): Promise<Record<string, unknown>> {
    return this.invoke('inspect', { tab_id, selector, offset, limit })
  }

  /**
   * Apply an observed action and verify its outcome.
   */
  public act(tab_id: string, action: string, target: Record<string, unknown>, value?: string, expect?: string, expected_text?: string[], timeout?: number): Promise<Record<string, unknown>> {
    return this.invoke('act', { tab_id, action, target, value, expect, expected_text, timeout })
  }

  /**
   * Attach the current tab's screenshot to the model.
   */
  public screenshot(): Promise<Record<string, unknown>> { return this.invoke('screenshot', {}) }

  public get toolName(): string { return 'cli' }
  public get toolkit(): string { return 'browser_use' }
  public get description(): string { return this.config.description }

  /**
   * Keep enablement instructions available even when a stale endpoint looks configured.
   */
  private createBrowserConnectionError(
    message: string,
    setupState = BrowserSetupState.ConnectionUnavailable,
    details: Omit<BrowserSetupFacts, 'owner_steps' | 'settings_url'> = {}
  ): BrowserSetupRequiredError {
    return new BrowserSetupRequiredError(message, setupState, {
      ...details,
      // Chromium browsers accept this URL and may display their own scheme, such as brave://.
      settings_url: REMOTE_DEBUGGING_SETTINGS_URL,
      owner_steps: [
        'Keep the chosen browser open with the usual signed-in profile.',
        `Enter ${REMOTE_DEBUGGING_SETTINGS_URL} in that browser’s address bar and open it.`,
        'Enable the checkbox labeled "Allow remote debugging for this browser instance" if it is off.',
        'Tell Leon when it is enabled so the connection can be retried.',
        'When the browser then shows "Allow remote debugging?", click "Allow" promptly to approve the new connection.',
        'If the checkbox is already enabled, leave it enabled and approve the connection prompt when retrying. If the option is missing, tell Leon.'
      ]
    })
  }

  /**
   * Resolve only the configured browser; never launch or copy an owner's profile.
   */
  private async resolveBrowserEndpoint(): Promise<string> {
    const settings = this.settings
    const settingsPath = this.getSettingsPath()
    const configurationRequired = (message: string): BrowserSetupRequiredError => new BrowserSetupRequiredError(
      message,
      BrowserSetupState.ConfigurationRequired,
      {
        settings_path: settingsPath,
        owner_steps: ['Choose the Chromium browser to use if the owner preference is not already known.']
      }
    )
    if (typeof settings['cdp_endpoint'] === 'string' && settings['cdp_endpoint'].trim()) {
      let endpoint: URL
      try {
        endpoint = new URL(settings['cdp_endpoint'].trim())
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(endpoint.protocol)) throw new Error()
      } catch {
        throw configurationRequired('cdp_endpoint must be an HTTP or WebSocket debugging endpoint.')
      }
      return endpoint.href
    }

    if (typeof settings['user_data_dir'] !== 'string' || !path.isAbsolute(settings['user_data_dir'])) {
      throw configurationRequired(
        `Set user_data_dir to the chosen browser's absolute user data directory, or set cdp_endpoint, in ${settingsPath}.`
      )
    }

    try {
      // Chromium publishes this endpoint after the owner enables remote debugging.
      // Reading it does not read cookies, clone the profile, or change browser settings.
      const content = await fs.readFile(path.join(settings['user_data_dir'], 'DevToolsActivePort'), 'utf8')
      const [rawPort, socketPath] = content.trim().split('\n').map((line) => line.trim())
      const port = Number(rawPort)
      if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT || !socketPath?.startsWith('/')) {
        throw new Error('Invalid debugging endpoint')
      }
      return `ws://127.0.0.1:${port}${socketPath}`
    } catch {
      throw this.createBrowserConnectionError(
        'The configured browser has no discoverable debugging endpoint.',
        BrowserSetupState.RemoteDebuggingRequired,
        {
          settings_path: settingsPath,
          user_data_dir: settings['user_data_dir']
        }
      )
    }
  }

  private async environment(): Promise<NodeJS.ProcessEnv> {
    const endpoint = await this.resolveBrowserEndpoint()
    const environment: NodeJS.ProcessEnv = {
      ...CLI_ENVIRONMENT,
      BH_HOME: path.join(path.dirname(this.getSettingsPath()), 'runtime'),
      BU_CDP_WS: endpoint.startsWith('ws') ? endpoint : '',
      BU_CDP_URL: endpoint.startsWith('http') ? endpoint : ''
    }
    const endpointPath = path.join(environment['BH_HOME']!, 'endpoint')
    let previousEndpoint = ''
    try { previousEndpoint = await fs.readFile(endpointPath, 'utf8') } catch {
      // The first standard worker also replaces any daemon from the previous implementation.
    }
    if (previousEndpoint !== endpoint) {
      // The CLI daemon retains its original environment across worker processes.
      // Reconnect when the owner changes browsers, before sending any task input.
      const stopped = await this.command(['--reload'], {
        env: environment, timeout: COMMAND_TIMEOUT_MS, reject: false
      })
      if (stopped.exitCode !== 0) throw new Error('Could not reset the previous browser connection.')
      await fs.mkdir(path.dirname(endpointPath), { recursive: true })
      await fs.writeFile(endpointPath, endpoint)
    }
    // Recheck even cached connections: disabling debugging can leave both the
    // endpoint file and our environment cache intact. This read never replays task input.
    const readiness = await this.command([], {
      input: 'list_tabs()', env: environment, timeout: COMMAND_TIMEOUT_MS, reject: false
    })
    if (readiness.exitCode !== 0 || readiness.timedOut) {
      throw this.createBrowserConnectionError('Browser Use CLI could not attach to the configured browser.')
    }
    return environment
  }

  private async perform(functionName: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!existsSync(CLI_PATH)) throw new Error('Browser Use dependencies are missing. Run Leon setup to install the tool dependencies.')
    if (functionName === 'run' && (typeof parameters['code'] !== 'string' || !parameters['code'].trim())) throw new Error('code must contain a Python script.')
    const env = await this.environment()
    const directory = path.join(PROFILE_SESSIONS_PATH,
      encodeURIComponent(process.env['LEON_SESSION_ID'] || 'unscoped'), 'artifacts', 'browser_use')
    await fs.mkdir(directory, { recursive: true })
    const screenshot = path.join(directory, `${randomUUID()}.png`)
    const actionsPath = path.join(directory, `${randomUUID()}.actions.json`)
    // JSON string literals are also valid Python strings for these generated paths.
    let code = functionName === 'screenshot'
      ? `print(capture_screenshot(path=${JSON.stringify(screenshot)}, max_dim=${SCREENSHOT_MAX_DIMENSION}))`
      : parameters['code'] as string
    if (functionName === 'inspect' || functionName === 'act') {
      // JSON decoding preserves optional booleans/nulls without generating Python literals.
      const argument = JSON.stringify(JSON.stringify(parameters))
      code = `p=json.loads(${argument})\nswitch_tab(p['tab_id'])\n`
      if (functionName === 'inspect') {
        code += 'print(json.dumps(leon_observe(**{k:v for k,v in p.items() if k!=\'tab_id\'})))'
      } else {
        code += 'operation={\'click\':leon_click,\'fill\':leon_fill,\'download\':leon_download}[p.pop(\'action\')]\np.pop(\'tab_id\')\nprint(json.dumps(operation(**p)))'
      }
    }
    // This support script runs inside the CLI, where upstream browser helpers are available.
    const workflow = await fs.readFile(path.join(SOURCE_DIRECTORY, 'lib', 'browser-use-runtime.py'), 'utf8')
    const startedAt = performance.now()
    const execution = this.command([], {
      input: `${workflow}\n_leon_execute(${JSON.stringify(code)})`, cwd: directory,
      env: { ...env, LEON_BROWSER_ARTIFACTS: directory, LEON_BROWSER_ACTIONS: actionsPath },
      timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, reject: false
    })
    const result = await execution
    let actions: Array<Record<string, unknown>> = []
    try {
      actions = JSON.parse(await fs.readFile(actionsPath, 'utf8')) as typeof actions
    } catch {
      // Syntax failures or forced termination may precede the first action record.
    }
    // A forced termination can bypass Python finally; the persisted record tells
    // us whether this execution still owns a download-behavior override.
    if (actions.some((action) => action['download_override_active'] === true)) {
      await this.command([], {
        input: 'cdp(\'Browser.setDownloadBehavior\', behavior=\'default\', eventsEnabled=False)',
        env, timeout: COMMAND_TIMEOUT_MS, reject: false
      }, true)
    }
    const success = result.exitCode === 0 && !result.timedOut && actions.every((action) => action['success'] === true)
    let observation: Record<string, unknown> | undefined
    let actionResult: Record<string, unknown> | undefined
    if (functionName === 'inspect' && success) observation = JSON.parse(result.stdout) as Record<string, unknown>
    if (functionName === 'act') {
      try { actionResult = JSON.parse(result.stdout) as Record<string, unknown> } catch {
        // Preserve raw diagnostic output if the CLI exits before returning JSON.
      }
    }
    observation ??= actions.findLast((action) => action['observation'])?.['observation'] as Record<string, unknown> | undefined
    // Keep one recovery snapshot; action records remain compact in predictable batches.
    actions = actions.map((action) => {
      const compact = { ...action }
      delete compact['observation']
      return compact
    })
    const outputTruncated = result.stdout.length > MAX_OUTPUT_PREVIEW_CHARACTERS || result.stderr.length > MAX_OUTPUT_PREVIEW_CHARACTERS
    const outputPath = path.join(directory, `${randomUUID()}.json`)
    if (outputTruncated) {
      await fs.writeFile(outputPath, JSON.stringify({ stdout: result.stdout, stderr: result.stderr }))
    }
    if (success && functionName === 'screenshot') await this.attachModelFile(screenshot, 'image/png')
    return {
      success,
      ...(!success ? { error: 'Browser Use CLI script failed; inspect before retrying because earlier actions may have completed.' } : {}),
      ...((functionName === 'inspect' && observation) || actionResult
        ? (actionResult ? { result: actionResult } : {})
        : { stdout: result.stdout.slice(0, MAX_OUTPUT_PREVIEW_CHARACTERS) }),
      stderr: result.stderr.slice(0, MAX_OUTPUT_PREVIEW_CHARACTERS), exit_code: result.exitCode,
      ...(outputTruncated ? { output_truncated: true, full_output_path: outputPath } : {}),
      timed_out: result.timedOut, duration_ms: Math.round(performance.now() - startedAt),
      artifacts_directory: directory,
      ...(observation ? { observation } : {}),
      ...(actions.length ? { browser_actions: actions } : {}),
      ...(!success ? { effect: actions.findLast((action) => action['success'] !== true)?.['effect'] ?? 'unverifiable' } : {})
    }
  }

  private async invoke(functionName: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
    const cancel = (): void => {
      this.canceled = true
      for (const child of this.running) child.kill('SIGTERM')
    }
    process.on('SIGTERM', cancel)
    process.on('SIGINT', cancel)
    const signal = this.executionContext?.signal
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    try {
      // Positional bridge arguments use null for omitted optional values.
      const supplied = Object.fromEntries(Object.entries(parameters).filter(([, value]) => value != null))
      return await this.perform(functionName, supplied)
    } catch (error) {
      if (error instanceof BrowserSetupRequiredError) {
        return {
          success: false, error: error.message, status: 'owner_action_required',
          error_code: 'browser_use_setup_pending', setup_state: error.setupState,
          setup: {
            component: 'Chromium remote debugging',
            purpose: 'browser use in the owner’s existing signed-in browser',
            ...error.setup,
            requires_logout: false,
            requires_browser_restart: false
          },
          guidance: error.setupState === BrowserSetupState.ConfigurationRequired
            ? 'Resolve and configure the owner’s chosen browser using existing tools and known preferences. Ask only if the choice or profile is unclear. Do not ask the owner to edit JSON when Leon can configure it.'
            : 'Explain why browser access is needed and the reported owner steps in a friendly message in your own words. Include the exact settings_url, the checkbox label, and the later Allow approval step; do not assume the owner already knows how to enable remote debugging. A discovered endpoint does not prove the checkbox is still enabled. Pause browser use until the owner completes the steps; do not repeat setup while waiting. Preserve the current browser session. Recheck readiness when the owner retries.'
        }
      }
      return { success: false, error: error instanceof Error ? error.message : String(error),
        code: 'browser_operation_failed', effect: 'unverifiable' }
    } finally {
      process.off('SIGTERM', cancel)
      process.off('SIGINT', cancel)
      signal?.removeEventListener('abort', cancel)
    }
  }

  private command(args: string[], options: import('execa').Options<string>, cleanup = false): ExecaChildProcess<string> {
    if (this.canceled && !cleanup) throw new Error('Browser execution canceled.')
    const child = execa(CLI_PATH, args, { ...options,
      env: { ...RuntimeHelper.getManagedNodeEnvironment(), ...options.env } })
    this.running.add(child)
    void child.then(() => this.running.delete(child), () => this.running.delete(child))
    return child
  }
}
