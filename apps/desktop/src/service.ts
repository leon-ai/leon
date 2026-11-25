import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { connect } from 'node:net'
import { closeSync, openSync } from 'node:fs'
import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { runCommand } from './process.js'
import { desktopSessionEnvironment } from './desktop-session.js'
import type { HostError, ServiceConfiguration } from './types.js'

interface ServiceOptions {
  home: string
  codebase: string
  node: string
  pnpm?: string | undefined
  runtimeHome?: string | undefined
  profile: string
  environment?: NodeJS.ProcessEnv
}
interface StartupDefinition {
  file: string
  content: string
  enable: [string, string[]]
  disable: [string, string[]]
}
export interface CoreService {
  configuration: ServiceConfiguration
  definition: StartupDefinition
  log: string
  start: () => Promise<void>
  setStartup: (enabled: boolean, options?: { keepRunning?: boolean }) => Promise<void>
}

const RESTART_DELAY_SECONDS = 10
const STOP_TIMEOUT_MS = 30_000
const STOP_POLL_INTERVAL_MS = 100
const MAXIMUM_LOG_BYTES = 5 * 1_024 * 1_024
const xml = (value: string | number): string => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&apos;')
const unitValue = (value: string, expandVariables = false): string => '"' + String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', () => expandVariables ? '$$' : '$').replaceAll('\n', '\\n').replaceAll('\r', '\\r') + '"'

/**
 * Sends authenticated commands to an owned launcher instead of killing saved PIDs.
 */
export function controlCore(configuration: ServiceConfiguration, action = 'status'): Promise<{ running: boolean, pid: number } | null> {
  return new Promise<{ running: boolean, pid: number } | null>((resolve) => {
    const socket = connect(configuration.controlPath)
    let text = ''
    socket.setTimeout(1_000, () => socket.destroy())
    socket.once('connect', () => socket.write(JSON.stringify({ token: configuration.controlToken, action }) + '\n'))
    socket.on('data', (chunk) => {
      text += chunk
      if (text.length > 4_096) {
        socket.destroy()
      }
    })
    socket.on('error', () => {})
    socket.once('close', () => {
      try {
        resolve(JSON.parse(text))
      } catch {
        resolve(null)
      }
    })
  })
}

/**
 * Waits for the authenticated runner to release its process and socket before
 * starting another instance under the same service configuration.
 */
export async function stopCoreAndWait(configuration: ServiceConfiguration): Promise<void> {
  const runner = await controlCore(configuration, 'stop')
  if (!runner) {
    return
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      process.kill(runner.pid, 0)
    } catch (error) {
      if ((error as HostError).code === 'ESRCH') {
        return
      }
      throw error
    }
    await delay(STOP_POLL_INTERVAL_MS)
  }

  throw new Error('My managed server did not stop. Open server logs, then retry.')
}

/**
 * Renders per-user startup definitions; the service runs Node without Chromium.
 */
export function serviceDefinition({ platform, id, node, runner, configurationPath, directory, log, home, username, uid, windowsRoot }: {
  platform: string
  id: string
  node: string
  runner: string
  configurationPath: string
  directory: string
  log: string
  home: string
  username: string
  uid: number
  windowsRoot?: string | undefined
}): StartupDefinition {
  const args = [node, runner, configurationPath]
  if (platform === 'darwin') {
    const file = path.join(home, 'Library/LaunchAgents', `${id}.plist`)
    return { file, content: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${xml(id)}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(directory)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>${RESTART_DELAY_SECONDS}</integer>
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>\n`, enable: ['launchctl', ['bootstrap', `gui/${uid}`, file]],
      disable: ['launchctl', ['bootout', `gui/${uid}/${id}`]] }
  }
  if (platform === 'linux') {
    const file = path.join(home, '.config/systemd/user', `${id}.service`)
    return { file, content: `[Unit]\nDescription=Leon server\nStartLimitIntervalSec=60\nStartLimitBurst=3\n\n[Service]\nType=simple\nExecStart=${[unitValue(node), ...args.slice(1).map((arg) => unitValue(arg, true))].join(' ')}\nWorkingDirectory=${unitValue(directory)}\nRestart=on-failure\nRestartSec=${RESTART_DELAY_SECONDS}\nTimeoutStopSec=90\n\n[Install]\nWantedBy=default.target\n`,
      enable: ['systemctl', ['--user', 'enable', '--now', `${id}.service`]],
      disable: ['systemctl', ['--user', 'disable', '--now', `${id}.service`]] }
  }
  if (platform === 'win32') {
    if (!windowsRoot) {
      throw new Error('Windows system directory is unavailable')
    }
    const file = path.join(directory, 'startup-task.xml')
    return { file, content: `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(username)}</UserId></LogonTrigger><TimeTrigger><Repetition><Interval>PT1M</Interval></Repetition><StartBoundary>2000-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
<Principals><Principal id="Owner"><UserId>${xml(username)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><Priority>5</Priority><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings>
<Actions Context="Owner"><Exec><Command>${xml(path.win32.join(windowsRoot, 'System32/conhost.exe'))}</Command><Arguments>--headless ${xml(args.map((arg) => '"' + arg.replaceAll('"', '\\"') + '"').join(' '))}</Arguments><WorkingDirectory>${xml(directory)}</WorkingDirectory></Exec></Actions></Task>\n`,
      enable: ['schtasks.exe', ['/Create', '/TN', id, '/XML', file, '/F']],
      disable: ['schtasks.exe', ['/Delete', '/TN', id, '/F']] }
  }
  throw new Error('Startup services are unavailable on this operating system')
}

/**
 * Keeps stable service files beside managed state, independent of app upgrades.
 */
export async function createCoreService({ home, codebase, node, pnpm, runtimeHome, profile, environment = process.env }: ServiceOptions): Promise<CoreService> {
  const identity = createHash('sha256').update(await realpath(home)).digest('hex').slice(0, 16)
  const id = `ai.getleon.core.${identity}`
  const directory = path.join(home, 'desktop', 'service')
  const configurationPath = path.join(directory, 'core.json')
  // Startup registrations reference this installed runner path.
  const runner = path.join(directory, 'core-runner.mjs')
  const log = path.join(directory, 'core.log')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const existing: ServiceConfiguration | null = await readFile(configurationPath, 'utf8').then(JSON.parse).catch(() => null)
  // A service must retain its authentication token while an older GUI is closed.
  const configuration: ServiceConfiguration = { node, pnpm, runtimeHome, codebase, directory,
    controlPath: process.platform === 'win32' ? `\\\\.\\pipe\\leon-core-${identity}` : path.join(os.tmpdir(), `leon-core-${os.userInfo().uid}-${identity}.sock`),
    controlToken: existing?.controlToken ?? randomBytes(32).toString('hex'),
    environment: { ...Object.fromEntries(['HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'GIT_EXEC_PATH', 'GIT_TEMPLATE_DIR', 'GIT_CONFIG_SYSTEM', 'GIT_SSL_CAINFO', 'PREFIX', 'GIT_TERMINAL_PROMPT'].filter((name) => environment[name]).map((name) => [name, environment[name]])),
      PATH: [path.dirname(node), ...(pnpm ? [path.dirname(pnpm)] : []), environment['PATH'] ?? ''].join(path.delimiter),
      LEON_HOME: home, LEON_PROFILE: profile, LEON_CODEBASE_PATH: codebase,
      ...(runtimeHome ? { LEON_RUNTIME_HOME: runtimeHome, LEON_RUNTIME_LAUNCHER_NODE: node } : {}),
      LEON_OPEN_BROWSER: 'false' } }
  if (existing && await controlCore(existing)) {
    const sameKind = Boolean(runtimeHome) === Boolean(existing.runtimeHome)
    const sameInstallation = sameKind && (runtimeHome
      ? await realpath(existing.runtimeHome!) === await realpath(runtimeHome)
      : await realpath(existing.codebase) === await realpath(codebase))
    if (!sameInstallation) {
      throw new Error('Another managed checkout is already running in this Leon home')
    }
  } else {
    await cp(fileURLToPath(new URL('./server-runner.js', import.meta.url)), runner)
    await writeFile(`${configurationPath}.pending`, JSON.stringify(configuration), { mode: 0o600 })
    await rename(`${configurationPath}.pending`, configurationPath)
  }
  const definition = serviceDefinition({ platform: process.platform, id, node, runner, configurationPath,
    directory, log, home: os.homedir(), username: process.platform === 'win32' && environment['USERDOMAIN']
      ? `${environment['USERDOMAIN']}\\${os.userInfo().username}` : os.userInfo().username, uid: os.userInfo().uid, windowsRoot: environment['SYSTEMROOT'] ?? environment['SystemRoot'] })
  const service: CoreService = { configuration: existing && await controlCore(existing) ? existing : configuration, definition, log,
    async start() {
      if (await controlCore(configuration)) {
        return
      }
      const info = await stat(log).catch(() => null)
      if ((info?.size ?? 0) > MAXIMUM_LOG_BYTES) {
        await rm(`${log}.previous`, { force: true })
        await rename(log, `${log}.previous`)
      }
      const output = openSync(log, 'a', 0o600)
      try {
        const child = spawn(node, [runner, configurationPath], { cwd: directory,
          env: { ...configuration.environment, ...desktopSessionEnvironment(environment) },
          detached: true, windowsHide: true, stdio: ['ignore', output, output] })
        await new Promise<void>((resolve, reject) => {
          child.once('spawn', resolve)
          child.once('error', reject)
        })
        child.unref()
      } finally {
        closeSync(output)
      }
    },
    async setStartup(enabled, { keepRunning = true } = {}) {
      const wasRunning = Boolean((await controlCore(configuration))?.running)
      // Registration happens only through an explicit owner action, never startup.
      if (enabled) {
        await mkdir(path.dirname(definition.file), { recursive: true, mode: 0o700 })
        await writeFile(definition.file, definition.content, { mode: 0o600 })
        if (process.platform === 'linux') {
          await runCommand('systemctl', ['--user', 'daemon-reload'])
        }
        await runCommand(...definition.enable)
      } else {
        await runCommand(...definition.disable)
        await rm(definition.file, { force: true })
        if (process.platform === 'linux') {
          await runCommand('systemctl', ['--user', 'daemon-reload'])
        }
        if (wasRunning && keepRunning) {
          // Disabling sign-in startup must not also stop the current instance.
          const deadline = Date.now() + 10_000
          let status = await controlCore(configuration)
          while (status && !status.running && Date.now() < deadline) {
            await delay(50)
            status = await controlCore(configuration)
          }
          if (!status) {
            await this.start()
          }
        }
      }
    }
  }

  return service
}
