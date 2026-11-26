import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Session, SafeStorage } from 'electron'

import contract from '../runtime/desktop-contract.mjs'
import { DEFAULT_WEB_THEME, WEB_THEMES, WebPreferenceKey, type WebColorScheme, type WebTheme } from '../../../bridges/runtime/contracts/desktop-client'
import type { DeviceGrant } from '../../../bridges/runtime/contracts/device-execution'

const MAXIMUM_PREFERENCE_CHARACTERS = 16_384

export interface DesktopState {
  readonly colorScheme: WebColorScheme
  bootstrap: (nonce?: string) => string
  update: (values: Record<string, unknown>) => Promise<void>
  loadDeviceGrant: (profile: string) => Promise<DeviceGrant | undefined>
  saveDeviceGrant: (profile: string, grant?: DeviceGrant) => Promise<void>
  readDevicePermission: (profile: string) => Promise<boolean | undefined>
  saveDevicePermission: (profile: string, allowed: boolean) => Promise<void>
  close: () => Promise<void>
}

function allowedKey(key: string): boolean {
  return contract.preferenceKeys.some((value) => value === key) || contract.preferencePrefixes.some((prefix) =>
    key.startsWith(prefix) && key.length > prefix.length && key.length <= 256)
}

async function atomicWrite(file: string, value: string | Buffer): Promise<void> {
  const pending = `${file}.${randomUUID()}.pending`
  await writeFile(pending, value, { mode: 0o600 })
  await rename(pending, file)
}

/**
 * Keeps preferences and encrypted authentication separate for each backend.
 * Diagnostic packages are ephemeral and never touch an owner's desktop state.
 */
export async function createDesktopState({ directory, backend, session, safeStorage, ephemeral, onColorSchemeChange }: {
  directory: string
  backend: URL
  session: Session
  safeStorage: SafeStorage | undefined
  ephemeral: boolean
  onColorSchemeChange?: () => void
}): Promise<DesktopState> {
  const identity = createHash('sha256').update(backend.origin).digest('hex')
  const root = path.join(directory, 'servers', identity)
  const preferencesFile = path.join(root, 'preferences.json')
  const cookiesFile = path.join(root, 'cookies.enc')
  const deviceFile = (profile: string, extension = '.enc'): string => path.join(root,
    'device-' + createHash('sha256').update(profile).digest('hex') + extension)
  const devicePermissions = new Map<string, boolean>()
  let preferences: Record<string, string> = {}
  let writes = Promise.resolve()
  let encryption: Promise<boolean> | undefined

  function colorScheme(): WebColorScheme {
    const value = preferences[WebPreferenceKey.Theme]

    return value === 'system' || WEB_THEMES.includes(value as WebTheme)
      ? value as WebColorScheme : DEFAULT_WEB_THEME
  }

  async function canEncrypt(): Promise<boolean> {
    if (ephemeral || !safeStorage) {
      return false
    }
    // Initialize the OS store only for real credentials. Cache denial for this
    // launch so cookie changes cannot repeatedly prompt or block the owner.
    encryption ??= safeStorage.isAsyncEncryptionAvailable().then((available) => available &&
      !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')).catch(() => false)
    return encryption
  }
  if (!ephemeral) {
    await mkdir(root, { recursive: true, mode: 0o700 })
    try {
      const saved = JSON.parse(await readFile(preferencesFile, 'utf8'))
      preferences = Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] =>
        allowedKey(entry[0]) && typeof entry[1] === 'string' && entry[1].length <= MAXIMUM_PREFERENCE_CHARACTERS))
    } catch {
      preferences = {}
    }
  }
  if (!ephemeral && safeStorage) {
    try {
      const saved = await readFile(cookiesFile)
      if (await canEncrypt()) {
        const decoded = await safeStorage.decryptStringAsync(saved)
        const cookies = JSON.parse(decoded.result)
        for (const cookie of cookies) {
          if (cookie.name === contract.profileCookieName &&
            (cookie.expirationDate === undefined || cookie.expirationDate > Date.now() / 1_000)) {
            await session.cookies.set({ ...cookie, url: backend.origin })
          }
        }
        if (decoded.shouldReEncrypt) {
          await saveCookies()
        }
      }
    } catch (error) {
      // Missing/rotated OS encryption keys require a fresh sign-in, never a
      // plaintext fallback or a change to the owner's Leon profile credentials.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        encryption = Promise.resolve(false)
      }
    }
  }

  async function saveCookies(): Promise<void> {
    if (ephemeral || !safeStorage) {
      return
    }
    const current = await session.cookies.get({ url: backend.origin })
    const cookies = current.filter((cookie) => cookie.name === contract.profileCookieName && cookie.value).map((cookie) => ({
      name: cookie.name, value: cookie.value, path: cookie.path, secure: cookie.secure,
      httpOnly: cookie.httpOnly, expirationDate: cookie.expirationDate, sameSite: cookie.sameSite,
      ...(!cookie.hostOnly ? { domain: cookie.domain } : {})
    }))
    if (!cookies.length) {
      // Sign-out removes the retained credential without unlocking Keychain.
      await rm(cookiesFile, { force: true })
    } else if (await canEncrypt()) {
      await atomicWrite(cookiesFile, await safeStorage.encryptStringAsync(JSON.stringify(cookies)))
    }
  }
  const changed = (): void => {
    writes = writes.then(saveCookies).catch(() => {
      encryption = Promise.resolve(false)
      console.warn('I could not retain the desktop sign-in in secure storage.')
    })
  }
  session.cookies.on('changed', changed)

  return {
    get colorScheme(): WebColorScheme {
      return colorScheme()
    },
    bootstrap(nonce = ''): string {
      const values = JSON.stringify(preferences).replaceAll('<', '\\u003c')
      return `<meta name="leon-desktop" content="true"><script nonce="${nonce}">for(const [key,value] of Object.entries(${values})){localStorage.setItem(key,value)}</script>`
    },
    update(values: Record<string, unknown>): Promise<void> {
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw Object.assign(new Error('Invalid preferences'), { status: 400 })
      }
      for (const [key, value] of Object.entries(values)) {
        if (!allowedKey(key) || typeof value !== 'string' || value.length > MAXIMUM_PREFERENCE_CHARACTERS) {
          throw Object.assign(new Error('Invalid preferences'), { status: 400 })
        }
      }
      const previousScheme = colorScheme()

      preferences = { ...preferences, ...values as Record<string, string> }
      if (colorScheme() !== previousScheme) {
        // Notify after validation, without waiting for disk I/O to color controls.
        onColorSchemeChange?.()
      }
      if (!ephemeral) {
        const snapshot = JSON.stringify(preferences)
        writes = writes.catch(() => undefined).then(() => atomicWrite(preferencesFile, snapshot))
      }
      return writes
    },
    async loadDeviceGrant(profile): Promise<DeviceGrant | undefined> {
      try {
        const saved = await readFile(deviceFile(profile))
        if (safeStorage && await canEncrypt()) {
          const decoded = await safeStorage.decryptStringAsync(saved)
          const grant = JSON.parse(decoded.result) as DeviceGrant
          if (grant.profile === profile && typeof grant.credential === 'string' && Array.isArray(grant.tools)) {
            return grant
          }
        }
      } catch {
        // An unavailable key or stale file requires explicit enrollment.
      }
      return undefined
    },
    async saveDeviceGrant(profile, grant): Promise<void> {
      if (!grant && !ephemeral) {
        await rm(deviceFile(profile), { force: true })
      } else if (grant && safeStorage && await canEncrypt()) {
        await atomicWrite(deviceFile(profile), await safeStorage.encryptStringAsync(JSON.stringify(grant)))
      }
    },
    async readDevicePermission(profile): Promise<boolean | undefined> {
      if (ephemeral || devicePermissions.has(profile)) {
        return devicePermissions.get(profile)
      }
      const decision = await readFile(deviceFile(profile, '.permission'), 'utf8').catch(() => '')

      return decision === 'allow' ? true : decision === 'deny' ? false : undefined
    },
    async saveDevicePermission(profile, allowed): Promise<void> {
      devicePermissions.set(profile, allowed)
      if (!ephemeral) {
        await atomicWrite(deviceFile(profile, '.permission'), allowed ? 'allow' : 'deny')
      }
    },
    async close(): Promise<void> {
      session.cookies.off('changed', changed)
      await writes.catch(() => undefined)
    }
  }
}
