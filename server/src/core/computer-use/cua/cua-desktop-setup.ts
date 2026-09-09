import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import execa from 'execa'

import { NetworkHelper } from '@/helpers/network-helper'
import type { ToolProviderExecutionInput } from '@/core/tool-provider/types'

const WAYLAND_ENV = 'CUA_DRIVER_RS_ENABLE_WAYLAND'
const GNOME_DESKTOP = 'gnome'
const EXTENSION_UUID = 'winrects@cua'
const EXTENSION_FILES = ['metadata.json', 'extension.js'] as const
const EXTENSION_SOURCE = 'https://raw.githubusercontent.com/trycua/cua'
const COMMAND_TIMEOUT_MS = 5_000
const ACTIVE_EXTENSION_PATTERN = /State: (?:ACTIVE|ENABLED)\b/
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const GNOME_VERSION_PATTERN = /\b(\d+)\.\d+/
const SETTINGS_SCHEMA = 'org.gnome.shell'
const ENABLED_EXTENSIONS_KEY = 'enabled-extensions'
const EMPTY_STRING_ARRAY = '@as []'

export enum CuaDesktopSetupState {
  Ready = 'ready',
  ActivationPending = 'activation_pending'
}

/** Detects Wayland without mistaking its XWayland DISPLAY for an X11 session. */
export function isCuaWaylandSession(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): boolean {
  if (platform !== 'linux') return false
  const sessionType = environment['XDG_SESSION_TYPE']?.trim().toLowerCase()
  return sessionType === 'wayland' || (
    !sessionType && Boolean(environment['WAYLAND_DISPLAY']?.trim())
  )
}

/** Prepares local Cua dependencies on demand; remote drivers own their setup. */
export class CuaDesktopSetup {
  private installation: Promise<void> | undefined

  public constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly dataHome: string = environment['XDG_DATA_HOME'] ||
      path.join(os.homedir(), '.local', 'share')
  ) {}

  /** Installs missing GNOME support and checks activation independently of files. */
  public async ensure(
    onProgress?: ToolProviderExecutionInput['onProgress']
  ): Promise<CuaDesktopSetupState> {
    if (!isCuaWaylandSession(this.platform, this.environment)) {
      return CuaDesktopSetupState.Ready
    }

    // Explicit owner overrides remain authoritative, including an empty value.
    this.environment[WAYLAND_ENV] ??= '1'
    const enabled = this.environment[WAYLAND_ENV]!.trim().toLowerCase()
    if (!enabled || enabled === '0' || enabled === 'false') {
      return CuaDesktopSetupState.Ready
    }
    const desktops = this.environment['XDG_CURRENT_DESKTOP']
      ?.toLowerCase().split(':') || []
    if (!desktops.includes(GNOME_DESKTOP)) return CuaDesktopSetupState.Ready

    if (!this.installation) {
      this.installation = this.install(onProgress).catch((error: unknown) => {
        // A failed download must be retryable on the next tool invocation.
        this.installation = undefined
        throw error
      })
    }
    await this.installation

    // GNOME can discover the extension later without restarting Leon.
    await this.command('gnome-extensions', ['enable', EXTENSION_UUID], false)
    const info = await this.command('gnome-extensions', ['info', EXTENSION_UUID], false)
    return ACTIVE_EXTENSION_PATTERN.test(info)
      ? CuaDesktopSetupState.Ready
      : CuaDesktopSetupState.ActivationPending
  }

  private async command(name: string, args: string[], reject = true): Promise<string> {
    const result = await execa(name, args, {
      env: { ...this.environment, LC_ALL: 'C' },
      timeout: COMMAND_TIMEOUT_MS,
      reject
    })
    return result.stdout
  }

  private async install(onProgress?: ToolProviderExecutionInput['onProgress']): Promise<void> {
    const extensionsPath = path.join(this.dataHome, 'gnome-shell', 'extensions')
    const destination = path.join(extensionsPath, EXTENSION_UUID)
    const metadataPath = path.join(destination, EXTENSION_FILES[0])
    if (fs.existsSync(destination)) {
      // Never replace an owner's existing extension or live Shell code silently.
      await this.checkCompatibility(metadataPath)
      await fs.promises.access(path.join(destination, EXTENSION_FILES[1]))
      await this.enableForNextSession()
      return
    }

    onProgress?.({ source: 'log', message: 'Installing Cua support for GNOME Wayland.' })
    const entryPath = fileURLToPath(import.meta.resolve('@trycua/cua-driver'))
    const packagePath = path.resolve(path.dirname(entryPath), '..', 'package.json')
    const { version } = JSON.parse(await fs.promises.readFile(packagePath, 'utf8')) as { version: string }
    if (!VERSION_PATTERN.test(version)) throw new Error('Cannot resolve a version-pinned Cua desktop helper.')

    await fs.promises.mkdir(extensionsPath, { recursive: true })
    const staging = await fs.promises.mkdtemp(path.join(extensionsPath, '.cua-setup-'))
    try {
      for (const filename of EXTENSION_FILES) {
        await NetworkHelper.downloadFile(
          `${EXTENSION_SOURCE}/cua-driver-rs-v${version}/libs/cua-driver/wayland-helper/${EXTENSION_UUID}/${filename}`,
          path.join(staging, filename),
          { cliProgress: false, parallelStreams: 1 }
        )
      }
      await this.checkCompatibility(path.join(staging, EXTENSION_FILES[0]))
      // Publish only a complete, compatible extension, never half a download.
      await fs.promises.rename(staging, destination)
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true })
    }

    await this.enableForNextSession()
    onProgress?.({ source: 'log', message: 'Cua GNOME support installed. Checking whether it is active.' })
  }

  private async checkCompatibility(metadataPath: string): Promise<void> {
    const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8')) as {
      uuid?: string
      'shell-version'?: string[]
    }
    const shellVersion = (await this.command('gnome-shell', ['--version']))
      .match(GNOME_VERSION_PATTERN)?.[1]
    if (metadata.uuid !== EXTENSION_UUID || !shellVersion ||
        !metadata['shell-version']?.includes(shellVersion)) {
      throw new Error('The Cua desktop helper does not support this GNOME Shell version.')
    }
  }

  private async enableForNextSession(): Promise<void> {
    const current = (await this.command('gsettings', ['get', SETTINGS_SCHEMA, ENABLED_EXTENSIONS_KEY])).trim()
    const entries = current === EMPTY_STRING_ARRAY ? '[]' : current
    if (!entries.startsWith('[') || !entries.endsWith(']')) {
      throw new Error('Cannot read GNOME enabled extensions; existing settings were preserved.')
    }
    if (entries.includes(`'${EXTENSION_UUID}'`) || entries.includes(`"${EXTENSION_UUID}"`)) return
    const prefix = entries.slice(0, -1).trimEnd()
    await this.command('gsettings', [
      'set', SETTINGS_SCHEMA, ENABLED_EXTENSIONS_KEY,
      `${prefix}${prefix === '[' ? '' : ', '}'${EXTENSION_UUID}']`
    ])
  }
}

/** Identifies setup that needs activation without confusing it with app failure. */
export class CuaDesktopSetupPendingError extends Error {
  public constructor() {
    super('GNOME WinRects is installed but not active in the current desktop session.')
    this.name = 'CuaDesktopSetupPendingError'
  }
}
