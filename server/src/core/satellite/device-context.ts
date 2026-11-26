import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'

import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'
import { DEVICE_CREDENTIAL_HEADER, DEVICE_SELECTION_HEADER } from '@@/bridges/runtime/contracts/device-execution'
import { authenticateProfileCredential, readProfileCredentialFromHeaders } from '@/core/profile-runtime/profile-auth'
import { authenticateDevice, readPairedDevice } from './device-pairing'

const deviceContext = new AsyncLocalStorage<string | undefined>()
const satelliteWorker = new AsyncLocalStorage<boolean>()

/**
 * Binds a trusted, profile-owned desktop selection to an accepted command.
 */
export function runWithSelectedDevice<T>(id: string | undefined, execute: () => T): T {
  return deviceContext.run(id, execute)
}

/**
 * Resolves a native pairing or explicit owner selection for the active profile.
 */
export function readDeviceSelection(headers: {
  [key: string]: unknown
  authorization?: string | undefined
  cookie?: string | undefined
}): string | undefined {
  const profile = getActiveProfileName()
  const credential = headers[DEVICE_CREDENTIAL_HEADER]
  if (credential !== undefined) {
    const device = authenticateDevice(credential)
    if (device?.profile !== profile) {
      throw new Error('This device pairing is unavailable for the signed-in profile.')
    }
    return device.id
  }

  const id = headers[DEVICE_SELECTION_HEADER]
  if (id === undefined) {
    return undefined
  }
  const owner = authenticateProfileCredential(readProfileCredentialFromHeaders({
    authorization: headers.authorization,
    cookie: headers.cookie,
    'x-leon-profile-token': String(headers['x-leon-profile-token'] ?? '')
  }))
  if (owner?.profileName !== profile || typeof id !== 'string' || !readPairedDevice(profile, id)) {
    throw new Error('Select a paired device for this profile.')
  }

  return id
}

/**
 * Gets the selected device of the originating command.
 */
export function getSelectedDevice(): string | undefined {
  return deviceContext.getStore()
}

/**
 * Runs an already-routed invocation on its Satellite process.
 */
export function runOnSatellite<T>(execute: () => T): T {
  return satelliteWorker.run(true, execute)
}

/**
 * Identifies an invocation already dispatched to its execution host.
 */
export function isSatelliteWorker(): boolean {
  return satelliteWorker.getStore() === true
}

function bindingPath(): string | undefined {
  const session = getActiveConversationSessionId()
  if (!session || session === '.' || session === '..') {
    return undefined
  }

  return path.join(getProfilePaths(getActiveProfileName()).sessions,
    encodeURIComponent(session), '.execution-device')
}

/**
 * Reads the conversation's device so resumed actions keep their original target.
 */
export function getConversationDevice(): string | undefined {
  const filename = bindingPath()
  if (!filename) {
    return undefined
  }

  try {
    return fs.readFileSync(filename, 'utf8') || undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    return undefined
  }
}

/**
 * Pins the first device atomically before any observation or input is dispatched.
 */
export function bindConversationDevice(device: string): boolean {
  const filename = bindingPath()
  if (!filename) {
    return true
  }
  const previous = getConversationDevice()
  if (previous) {
    return previous === device
  }

  fs.mkdirSync(path.dirname(filename), { recursive: true })
  try {
    fs.writeFileSync(filename, device, { flag: 'wx', mode: 0o600 })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
    return getConversationDevice() === device
  }
}
