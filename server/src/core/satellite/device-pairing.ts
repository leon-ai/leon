import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { getProfilePaths, isValidProfileName } from '@/core/profile-runtime/profile-paths'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'

interface PairedDevice {
  id: string
  name: string
  tools: string[]
  digest: string
}

const DEVICE_DIRECTORY = 'paired-devices'
export const PAIRED_DEVICE_ID_PREFIX = 'desktop-'
const DEVICE_ID_PATTERN = /^desktop-[a-f0-9-]{36}$/

function devicePath(profile: string, id: string): string {
  return path.join(getProfilePaths(profile).root, DEVICE_DIRECTORY, id + '.json')
}

/**
 * Looks up the enrollment for an authenticated owner's selected device.
 */
export function readPairedDevice(profile: string, id: string): PairedDevice | null {
  if (!DEVICE_ID_PATTERN.test(id)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(devicePath(profile, id), 'utf8')) as PairedDevice
  } catch {
    return null
  }
}

/**
 * Issues an independently revocable credential for a bounded set of tools.
 */
export async function pairDevice(name: string, tools: string[]): Promise<{ id: string, credential: string }> {
  const profile = getActiveProfileName()
  const id = PAIRED_DEVICE_ID_PREFIX + randomUUID()
  const secret = randomBytes(32).toString('hex')
  const filename = devicePath(profile, id)
  const record: PairedDevice = {
    id, name, tools, digest: createHash('sha256').update(secret).digest('hex')
  }

  await fs.promises.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  await fs.promises.writeFile(filename, JSON.stringify(record), { flag: 'wx', mode: 0o600 })

  return { id, credential: [profile, id, secret].join(':') }
}

/**
 * Checks a Satellite credential without granting any profile API permissions.
 */
export function authenticateDevice(value: unknown): (PairedDevice & { profile: string }) | null {
  if (typeof value !== 'string' || value.length > 256) {
    return null
  }
  const [profile, id, secret, extra] = value.split(':')
  if (extra !== undefined || !profile || !isValidProfileName(profile) ||
      !id || !secret || !/^[a-f0-9]{64}$/.test(secret)) {
    return null
  }

  const device = readPairedDevice(profile, id)
  const digest = device && Buffer.from(device.digest, 'hex')
  const candidate = createHash('sha256').update(secret).digest()

  return device && digest?.length === candidate.length && timingSafeEqual(digest, candidate)
    ? { ...device, profile } : null
}

/**
 * Deletes only the active profile's selected enrollment.
 */
export async function revokeDevice(id: string): Promise<void> {
  if (DEVICE_ID_PATTERN.test(id)) {
    await fs.promises.rm(devicePath(getActiveProfileName(), id), { force: true })
  }
}

/** Lists owner enrollments without transmitting credentials or digests. */
export async function listPairedDevices(profile: string): Promise<Array<Pick<PairedDevice, 'id' | 'name'>>> {
  const directory = path.join(getProfilePaths(profile).root, DEVICE_DIRECTORY)
  const files = await fs.promises.readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error
    }
    return []
  })

  return files.flatMap((file) => {
    const device = readPairedDevice(profile, path.basename(file, '.json'))

    return device ? [{ id: device.id, name: device.name }] : []
  })
}
