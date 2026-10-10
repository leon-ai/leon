import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { LEON_PROFILES_PATH } from '@/leon-roots'
import { getProfilePaths, isValidProfileName } from '@/core/profile-runtime/profile-paths'

import { createSetupStatus } from './setup-status'

const MIGRATIONS_PATH = fileURLToPath(new URL('./migrations/', import.meta.url))
const MIGRATION_FILENAME_PATTERN = /^\d{16}-[a-z0-9]+(?:-[a-z0-9]+)*\.js$/
const PREVIOUS_MIGRATION_FILENAME_PATTERN = /^\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*\.js$/
const RECEIPTS_FILENAME = '.setup-migrations.json'
const LOCK_DIRECTORY = '.setup-migrations.lock'
const MAX_LOCK_ATTEMPTS = 3

function processIsRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') {
      return false
    }
    if (error.code === 'EPERM') {
      return true
    }

    throw error
  }
}

async function removeEmptyLock(lockPath) {
  try {
    await fs.rmdir(lockPath)
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) {
      throw error
    }
  }
}

async function acquireMigrationLock(profileRoot) {
  const lockPath = path.join(profileRoot, LOCK_DIRECTORY)
  const candidate = await fs.mkdtemp(`${lockPath}-`)
  const owner = String(process.pid)
  let acquired = false

  try {
    // Publish an already populated directory so contenders never observe a
    // newly acquired lock without its process identity.
    await fs.writeFile(path.join(candidate, owner), '', { mode: 0o600 })

    for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt += 1) {
      try {
        await fs.rename(candidate, lockPath)
        acquired = true
        break
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) {
          // Windows can report an existing destination directory as a
          // permission error. Only an observed lock permits recovery.
          const existing = ['EPERM', 'EACCES'].includes(error.code)
            ? await fs.stat(lockPath).catch(() => null)
            : null

          if (!existing?.isDirectory()) {
            throw error
          }
        }
      }

      const owners = await fs.readdir(lockPath).catch((error) => {
        if (error.code === 'ENOENT') {
          return []
        }

        throw error
      })

      if (owners.length === 0) {
        await removeEmptyLock(lockPath)
        continue
      }

      const previousOwner = owners[0]
      const pid = Number(previousOwner)

      if (
        owners.length !== 1 || !Number.isSafeInteger(pid) || pid < 1 ||
        String(pid) !== previousOwner || processIsRunning(pid)
      ) {
        throw new Error(`Setup migrations are already running or locked for ${profileRoot}.`)
      }

      // Claim the dead owner's exact filename first. A competing recovery
      // cannot remove a newly acquired lock belonging to a different process.
      try {
        await fs.rename(path.join(lockPath, previousOwner), path.join(lockPath, owner))
      } catch (error) {
        if (error.code === 'ENOENT') {
          continue
        }

        throw error
      }

      await fs.unlink(path.join(lockPath, owner))
      await removeEmptyLock(lockPath)
    }

    if (!acquired) {
      throw new Error(`Could not acquire setup migration lock for ${profileRoot}.`)
    }

    return async () => {
      await fs.unlink(path.join(lockPath, owner))
      await removeEmptyLock(lockPath)
    }
  } finally {
    if (!acquired) {
      await fs.rm(candidate, { recursive: true, force: true })
    }
  }
}

async function readCompletedMigrations(receiptsPath) {
  let content

  try {
    content = await fs.readFile(receiptsPath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      return new Set()
    }

    throw error
  }

  const receipts = JSON.parse(content)

  if (
    !Array.isArray(receipts?.completed) ||
    receipts.completed.some((id) =>
      typeof id !== 'string' || (
        !MIGRATION_FILENAME_PATTERN.test(id) &&
        !PREVIOUS_MIGRATION_FILENAME_PATTERN.test(id)
      )
    )
  ) {
    throw new Error(`Invalid setup migration records: ${receiptsPath}.`)
  }

  return new Set(receipts.completed)
}

async function saveCompletedMigrations(receiptsPath, completed) {
  const temporary = `${receiptsPath}.${randomUUID()}.tmp`

  try {
    const file = await fs.open(temporary, 'wx', 0o600)

    try {
      await file.writeFile(`${JSON.stringify({ completed: [...completed] }, null, 2)}\n`)
      await file.sync()
    } finally {
      await file.close()
    }

    await fs.rename(temporary, receiptsPath)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

/**
 * Apply pending migrations from oldest to newest UTC filename timestamp.
 * Record each successful result so completed work is never repeated.
 * A failed or interrupted migration remains pending and must be safe to retry.
 * @param {import('@/core/profile-runtime/profile-paths').ProfilePaths} profilePaths
 * @param {string} migrationsPath
 */
export async function runProfileMigrations(profilePaths, migrationsPath = MIGRATIONS_PATH) {
  const entries = await fs.readdir(migrationsPath, { withFileTypes: true })
  const migrations = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.js'))

  for (const migration of migrations) {
    if (!MIGRATION_FILENAME_PATTERN.test(migration.name)) {
      throw new Error(`Migration filenames must use YYYYMMDDHHmmssSS-description.js in UTC: ${migration.name}.`)
    }
  }

  migrations.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  const release = await acquireMigrationLock(profilePaths.root)
  const receiptsPath = path.join(profilePaths.root, RECEIPTS_FILENAME)
  const applied = []

  try {
    const completed = await readCompletedMigrations(receiptsPath)

    for (const { name } of migrations) {
      if (completed.has(name)) {
        continue
      }

      const { default: migrate, previousIds = [] } = await import(
        pathToFileURL(path.join(migrationsPath, name)).href
      )

      if (typeof migrate !== 'function') {
        throw new Error(`Migration ${name} must export a default migrate(profilePaths) function.`)
      }

      // Completed work keeps its identity when a migration filename changes.
      if (previousIds.some((id) => completed.has(id))) {
        for (const id of previousIds) {
          completed.delete(id)
        }

        completed.add(name)
        await saveCompletedMigrations(receiptsPath, completed)
        continue
      }

      try {
        await migrate(profilePaths)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)

        throw new Error(`Migration ${name} failed for profile ${profilePaths.name}: ${reason}`, { cause: error })
      }

      completed.add(name)
      await saveCompletedMigrations(receiptsPath, completed)
      applied.push(name)
    }

    return applied
  } finally {
    await release()
  }
}

/**
 * Update each existing profile before setup synchronizes tool defaults.
 */
export default async function setupMigrations() {
  const status = createSetupStatus('Applying setup migrations...').start()

  try {
    const profiles = await fs.readdir(LEON_PROFILES_PATH, { withFileTypes: true })
    const appliedMigrations = new Set()
    let affectedProfileCount = 0

    for (const profile of profiles.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (!profile.isDirectory() || !isValidProfileName(profile.name)) {
        continue
      }

      const applied = await runProfileMigrations(getProfilePaths(profile.name))

      if (applied.length === 0) {
        continue
      }

      affectedProfileCount += 1

      // Count migration identities separately from the profiles they changed.
      for (const migrationId of applied) {
        appliedMigrations.add(migrationId)
      }
    }

    const migrationCount = appliedMigrations.size
    const migrationLabel = migrationCount === 1 ? 'migration' : 'migrations'
    const profileLabel = affectedProfileCount === 1 ? 'profile' : 'profiles'
    const summary = migrationCount === 0
      ? 'no pending migrations'
      : `${migrationCount} ${migrationLabel} applied across ${affectedProfileCount} ${profileLabel}`

    status.succeed(`Setup migrations: ready (${summary})`)
  } catch (error) {
    status.fail('Failed to apply setup migrations')
    throw error
  }
}
