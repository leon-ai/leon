import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { afterEach, expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'

import { getProfilePaths, type ProfilePaths } from '@/core/profile-runtime/profile-paths'
import { runProfileMigrations } from '@@/scripts/setup/setup-migrations'
import migrateMediaToolSettings from '@@/scripts/setup/migrations/20261008-migrate-media-tool-settings'

const FIRST = '20261001-first.js'
const SECOND = '20261002-second.js'
const THIRD = '20261003-third.js'
const RECEIPTS_FILENAME = '.setup-migrations.json'
const LOCK_DIRECTORY = '.setup-migrations.lock'

let directory = ''
let migrationsPath = ''

afterEach(async () => {
  vi.restoreAllMocks()

  if (directory) {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

async function fixture(): Promise<void> {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-migrations-'))
  migrationsPath = path.join(directory, 'migrations')

  await fs.mkdir(migrationsPath)
  await fs.mkdir(path.join(directory, 'a'))
  await fs.mkdir(path.join(directory, 'b'))
}

function pathsFor(name: string): ProfilePaths {
  const original = getProfilePaths(name)
  const root = path.join(directory, name)

  return Object.fromEntries(Object.entries(original).map(([key, value]) => [
    key, key === 'name' ? value : value.replace(original.root, root)
  ])) as unknown as ProfilePaths
}

async function migration(name: string, operation = ''): Promise<void> {
  await fs.writeFile(path.join(migrationsPath, name), `
import fs from 'node:fs/promises'
import path from 'node:path'

export default async function migrate(profilePaths) {
  await fs.appendFile(path.join(profilePaths.root, 'trace'), ${JSON.stringify(`${name}\n`)})
  ${operation}
}
`)
}

async function completed(profile: ProfilePaths): Promise<string[]> {
  return JSON.parse(await fs.readFile(path.join(profile.root, RECEIPTS_FILENAME), 'utf8')).completed
}

it('runs migrations in filename order once per profile and discovers newly added IDs', async () => {
  await fixture()
  await migration(SECOND)
  await migration(FIRST)
  await fs.writeFile(path.join(migrationsPath, 'README.md'), 'Contributor guidance')
  const firstProfile = pathsFor('a')
  const secondProfile = pathsFor('b')

  expect(await runProfileMigrations(firstProfile, migrationsPath)).toEqual([FIRST, SECOND])
  expect(await runProfileMigrations(firstProfile, migrationsPath)).toEqual([])
  expect(await fs.readFile(path.join(firstProfile.root, 'trace'), 'utf8'))
    .toBe(`${FIRST}\n${SECOND}\n`)
  expect(await runProfileMigrations(secondProfile, migrationsPath)).toEqual([FIRST, SECOND])

  // Completion is a set of IDs: an earlier-dated addition is still pending.
  const added = '20260930-added.js'

  await migration(added)
  expect(await runProfileMigrations(firstProfile, migrationsPath)).toEqual([added])
  expect(await completed(firstProfile)).toEqual([FIRST, SECOND, added])
  expect(await completed(secondProfile)).toEqual([FIRST, SECOND])
  expect(await fs.readdir(firstProfile.root)).toEqual(expect.arrayContaining([RECEIPTS_FILENAME, 'trace']))
  expect((await fs.readdir(firstProfile.root)).some((file) => file.endsWith('.tmp') || file.startsWith(LOCK_DIRECTORY)))
    .toBe(false)
})

it('retains successful checkpoints, stops on failure and retries only pending migrations', async () => {
  await fixture()
  await migration(FIRST)
  await migration(SECOND, `
    if (!(await fs.stat(path.join(profilePaths.root, 'retry-ready')).catch(() => null))) {
      throw new Error('Required input is missing')
    }
  `)
  await migration(THIRD)
  const profile = pathsFor('a')

  await expect(runProfileMigrations(profile, migrationsPath)).rejects.toThrow(SECOND)
  expect(await completed(profile)).toEqual([FIRST])
  expect(await fs.readFile(path.join(profile.root, 'trace'), 'utf8')).toBe(`${FIRST}\n${SECOND}\n`)
  expect(await fs.stat(path.join(profile.root, LOCK_DIRECTORY)).catch(() => null)).toBeNull()
  await fs.writeFile(path.join(profile.root, 'retry-ready'), '')

  expect(await runProfileMigrations(profile, migrationsPath)).toEqual([SECOND, THIRD])
  expect(await completed(profile)).toEqual([FIRST, SECOND, THIRD])
  expect(await fs.readFile(path.join(profile.root, 'trace'), 'utf8'))
    .toBe(`${FIRST}\n${SECOND}\n${SECOND}\n${THIRD}\n`)
})

it('preserves the previous completion records when a checkpoint cannot be published', async () => {
  await fixture()
  await migration(FIRST)
  const profile = pathsFor('a')

  await runProfileMigrations(profile, migrationsPath)
  await migration(SECOND)
  const receipts = path.join(profile.root, RECEIPTS_FILENAME)
  const original = await fs.readFile(receipts, 'utf8')
  const rename = fs.rename
  const publication = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    if (destination === receipts) {
      throw Object.assign(new Error('Checkpoint publication failed'), { code: 'EACCES' })
    }

    await rename(source, destination)
  })

  await expect(runProfileMigrations(profile, migrationsPath)).rejects.toThrow('Checkpoint publication failed')
  expect(await fs.readFile(receipts, 'utf8')).toBe(original)
  expect((await fs.readdir(profile.root)).some((file) => file.endsWith('.tmp') || file.startsWith(LOCK_DIRECTORY)))
    .toBe(false)
  publication.mockRestore()

  expect(await runProfileMigrations(profile, migrationsPath)).toEqual([SECOND])
  expect(await completed(profile)).toEqual([FIRST, SECOND])
})

it.each(['empty', 'exited owner'])('recovers an interrupted runner with an %s lock', async (state) => {
  await fixture()
  await migration(FIRST)
  const profile = pathsFor('a')
  const lock = path.join(profile.root, LOCK_DIRECTORY)

  await fs.mkdir(lock)

  if (state === 'exited owner') {
    const exited = spawnSync(process.execPath, ['-e', ''], { timeout: 5_000 })

    expect(exited.status).toBe(0)
    await fs.writeFile(path.join(lock, String(exited.pid)), '')
  }

  expect(await runProfileMigrations(profile, migrationsPath)).toEqual([FIRST])
  expect(await completed(profile)).toEqual([FIRST])
  expect(await fs.stat(lock).catch(() => null)).toBeNull()
})

it('prevents concurrent processes from migrating the same profile', async () => {
  await fixture()
  await migration(FIRST, `
    process.stdout.write('migration-running\\n')

    while (!(await fs.stat(path.join(profilePaths.root, 'release')).catch(() => null))) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  `)
  const profile = pathsFor('a')
  const runner = pathToFileURL(path.resolve('scripts/setup/setup-migrations.js')).href
  const program = `
    const { runProfileMigrations } = await import(${JSON.stringify(runner)})
    await runProfileMigrations(${JSON.stringify(profile)}, ${JSON.stringify(migrationsPath)})
  `
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', program], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let diagnostics = ''

  child.stderr.on('data', (data) => {
    diagnostics += String(data)
  })
  const closed = new Promise<number | null>((resolve) => {
    child.once('close', resolve)
  })

  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', () => reject(new Error(diagnostics || 'Migration process exited before starting')))
      child.stdout.on('data', (data) => {
        if (String(data).includes('migration-running')) {
          resolve()
        }
      })
    })

    await expect(runProfileMigrations(profile, migrationsPath)).rejects.toThrow('already running')
    expect(await fs.stat(path.join(profile.root, RECEIPTS_FILENAME)).catch(() => null)).toBeNull()
    await fs.writeFile(path.join(profile.root, 'release'), '')

    expect(await closed, diagnostics).toBe(0)
    expect(await completed(profile)).toEqual([FIRST])
    expect(await fs.readFile(path.join(profile.root, 'trace'), 'utf8')).toBe(`${FIRST}\n`)
    expect(await runProfileMigrations(profile, migrationsPath)).toEqual([])
  } finally {
    child.kill()
    await closed
  }
})

it.each(['EPERM', 'EACCES'])('preserves a live owner when the filesystem reports a lock conflict as %s', async (code) => {
  await fixture()
  await migration(FIRST)
  const profile = pathsFor('a')
  const lock = path.join(profile.root, LOCK_DIRECTORY)
  const owner = String(process.pid)

  await fs.mkdir(lock)
  await fs.writeFile(path.join(lock, owner), '')
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('Destination exists'), { code }))

  await expect(runProfileMigrations(profile, migrationsPath)).rejects.toThrow('already running')
  expect(await fs.readdir(lock)).toEqual([owner])
  expect(await fs.stat(path.join(profile.root, 'trace')).catch(() => null)).toBeNull()
})

it.each(['{', '{"completed":null}'])('refuses to replay migrations when completion records are invalid: %s', async (content) => {
  await fixture()
  await migration(FIRST)
  const profile = pathsFor('a')
  const receipts = path.join(profile.root, RECEIPTS_FILENAME)

  await fs.writeFile(receipts, content)
  await expect(runProfileMigrations(profile, migrationsPath)).rejects.toThrow()

  expect(await fs.readFile(receipts, 'utf8')).toBe(content)
  expect(await fs.stat(path.join(profile.root, 'trace')).catch(() => null)).toBeNull()
  expect(await fs.stat(path.join(profile.root, LOCK_DIRECTORY)).catch(() => null)).toBeNull()
})

it('requires dated filenames and a callable migration entry point', async () => {
  await fixture()
  const profile = pathsFor('a')

  await migration('undated.js')
  await expect(runProfileMigrations(profile, migrationsPath)).rejects.toThrow('YYYYMMDD-description.js')
  await fs.unlink(path.join(migrationsPath, 'undated.js'))
  await fs.writeFile(path.join(migrationsPath, FIRST), 'export default 42')

  await expect(runProfileMigrations(profile, migrationsPath)).rejects.toThrow('default migrate(profilePaths)')
  expect(await fs.stat(path.join(profile.root, RECEIPTS_FILENAME)).catch(() => null)).toBeNull()
})

it('preserves destination preferences and profile access restrictions when tools move', async () => {
  await fixture()
  const profile = path.join(directory, 'a')
  const otherProfile = path.join(directory, 'b')
  const writeSettings = async (owner: string, toolkit: string, tool: string, settings: object): Promise<void> => {
    const target = path.join(owner, 'tools', toolkit, tool, 'settings.json')

    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify(settings))
  }

  await writeSettings(profile, 'media_production', 'document', { provider: 'openai' })
  await writeSettings(profile, 'media_generation', 'document', { provider: 'anthropic' })
  await writeSettings(profile, 'media_generation', 'typst', { timeout_ms: 45_000 })
  await writeSettings(profile, 'document', 'echarts', { width: 800 })
  await writeSettings(profile, 'media_production', 'echarts', { width: 400 })
  await writeSettings(otherProfile, 'media_production', 'document', { provider: 'anthropic' })
  const profilePaths = pathsFor('a')
  const config = profilePaths.config

  await fs.writeFile(config, stringify({
    availability: { tools: {
      allowed: ['media_generation.image', 'media_production.document', 'document.document'],
      disabled: ['media_production.typst', 'unrelated.tool']
    } },
    satellite: { tools: { 'media_production.typst': { device_id: 'laptop' } } }
  }))
  await migrateMediaToolSettings(profilePaths)

  const readSettings = async (tool: string): Promise<unknown> => JSON.parse(
    await fs.readFile(path.join(profile, 'tools', 'document', tool, 'settings.json'), 'utf8')
  )

  expect(await readSettings('document')).toEqual({ provider: 'openai' })
  expect(await readSettings('typst')).toEqual({ timeout_ms: 45_000 })
  expect(await readSettings('echarts')).toEqual({ width: 800 })
  const migratedConfig = await fs.readFile(config, 'utf8')

  expect(parse(migratedConfig)).toEqual({
    availability: { tools: {
      allowed: ['media_production.image', 'document.document'],
      disabled: ['document.typst', 'unrelated.tool']
    } },
    satellite: { tools: { 'document.typst': { device_id: 'laptop' } } }
  })
  await migrateMediaToolSettings(profilePaths)

  expect(await fs.readFile(config, 'utf8')).toBe(migratedConfig)
  expect(await fs.stat(path.join(otherProfile, 'tools', 'document')).catch(() => null))
    .toBeNull()
  expect(JSON.parse(await fs.readFile(
    path.join(profile, 'tools', 'media_production', 'document', 'settings.json'), 'utf8'
  ))).toEqual({ provider: 'openai' })
})
