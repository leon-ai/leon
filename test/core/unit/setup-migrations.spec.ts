import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { afterEach, expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'

import { getProfilePaths, type ProfilePaths } from '@/core/profile-runtime/profile-paths'
import { runProfileMigrations } from '@@/scripts/setup/setup-migrations'
import migrateMediaToolSettings from '@@/scripts/setup/migrations/2026100812124300-migrate-media-tool-settings'
import migrateInferenceUsage from '@@/scripts/setup/migrations/2026100823413300-backfill-inference-usage'
import { readInferenceUsage, type InferenceUsageRecord } from '@/core/llm-manager/llm-usage/usage-ledger'

const FIRST = '2026100120203102-z-first.js'
const SECOND = '2026100120203103-a-second.js'
const THIRD = '2026100200000000-third.js'
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

async function migration(
  name: string,
  operation = '',
  previousIds: string[] = []
): Promise<void> {
  await fs.writeFile(path.join(migrationsPath, name), `
import fs from 'node:fs/promises'
import path from 'node:path'

export const previousIds = ${JSON.stringify(previousIds)}

export default async function migrate(profilePaths) {
  await fs.appendFile(path.join(profilePaths.root, 'trace'), ${JSON.stringify(`${name}\n`)})
  ${operation}
}
`)
}

async function completed(profile: ProfilePaths): Promise<string[]> {
  return JSON.parse(await fs.readFile(path.join(profile.root, RECEIPTS_FILENAME), 'utf8')).completed
}

async function usageRecords(profile: ProfilePaths): Promise<InferenceUsageRecord[]> {
  const records: InferenceUsageRecord[] = []

  for await (const record of readInferenceUsage({}, profile)) {
    records.push(record)
  }

  return records
}

it('imports profile history once, preserving saved totals and excluding live-ledger overlap', async () => {
  await fixture()
  const profile = pathsFor('a')
  const session = path.join(profile.sessions, 'conversation')
  const timestamp = Date.parse('2026-10-01T12:00:00Z')
  const messages = [
    {
      who: 'leon', sentAt: timestamp, messageId: 'saved-turn', message: 'Private content',
      inference: {
        provider: 'openai', model: 'saved-model', authMode: 'chatgpt_oauth',
        credentialSource: 'account_binding', connectionRef: '012345abcdef',
        endpoint: 'https://provider.example/responses?secret=private'
      },
      llmMetrics: {
        inputTokens: 100, outputTokens: 20, completionCount: 3,
        usageAccounting: {
          cachedInputTokens: 60, cacheReadCompletionCount: 2, cacheWriteInputTokens: 0,
          costUSD: 0.5, costCompletionCount: 2, estimatedCostCompletionCount: 0,
          costSources: ['provider-reported']
        }
      },
      agentResponseTrace: { metrics: { inputTokens: 100, outputTokens: 20 } }
    },
    {
      who: 'leon', sentAt: timestamp + 1, messageId: 'no-route',
      llmMetrics: { inputTokens: 30, outputTokens: 5 }
    },
    {
      who: 'leon', sentAt: timestamp + 2, messageId: 'multiple-routes',
      inference: [{ provider: 'openai', model: 'first' }, { provider: 'anthropic', model: 'second' }],
      agentResponseTrace: { metrics: { inputTokens: 40, outputTokens: 10 } }
    },
    {
      who: 'leon', sentAt: timestamp + 3, messageId: 'estimated-price',
      llmMetrics: {
        inputTokens: 0, outputTokens: 0,
        usageAccounting: {
          cachedInputTokens: 0, cacheReadCompletionCount: 0, cacheWriteInputTokens: 0,
          costUSD: 99, costCompletionCount: 1, estimatedCostCompletionCount: 1,
          costSources: ['estimate']
        }
      }
    },
    { who: 'owner', sentAt: timestamp, llmMetrics: { inputTokens: 100, outputTokens: 20 } },
    { who: 'leon', sentAt: timestamp + 4, agentResponseTrace: { metrics: { durationMs: 50 } } },
    {
      who: 'leon', sentAt: timestamp + 10, messageId: 'live-turn',
      llmMetrics: { inputTokens: 500, outputTokens: 50 }
    }
  ]

  await fs.mkdir(session, { recursive: true })
  await fs.mkdir(path.join(profile.logs, 'usage'), { recursive: true })
  await fs.writeFile(path.join(session, 'conversation_log.json'), JSON.stringify(messages))
  await fs.writeFile(path.join(profile.root, 'conversation_log.json'), JSON.stringify(messages))
  const livePath = path.join(profile.logs, 'usage', '2026-10-01.jsonl')
  const live = JSON.stringify({
    id: 'live-attempt', startedAt: timestamp + 5, finishedAt: timestamp + 9,
    sessionId: 'conversation', provider: 'openai', model: 'current-model',
    purpose: 'react', outcome: 'completed', usage: { inputTokens: 500, outputTokens: 50 }
  }) + '\n'

  await fs.writeFile(livePath, live)
  await migrateInferenceUsage(profile)
  const records = await usageRecords(profile)
  const imported = records.filter((record) => record.historical)

  expect(imported).toHaveLength(4)
  expect(imported[0]).toMatchObject({
    sessionId: 'conversation', provider: 'openai', model: 'saved-model',
    inference: { connectionRef: '012345abcdef', endpoint: 'https://provider.example/responses' },
    historical: { completionCount: 3, accounting: { costCompletionCount: 2 } },
    usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 60, costUSD: 0.5 }
  })
  expect(imported[1]).toMatchObject({ provider: 'unknown', model: 'unknown', historical: {} })
  expect(imported[2]).toMatchObject({ provider: 'unknown', model: 'unknown' })
  expect(imported[3]?.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
  expect(JSON.stringify(records)).not.toContain('Private content')
  expect(JSON.stringify(records)).not.toContain('secret=private')
  expect(await fs.readFile(livePath, 'utf8')).toBe(live)

  await migrateInferenceUsage(profile)
  expect(await usageRecords(profile)).toEqual(records)
  await migrateInferenceUsage(pathsFor('b'))
  expect(await usageRecords(pathsFor('b'))).toEqual([])
})

it('publishes historical usage only after all source conversations have been read successfully', async () => {
  await fixture()
  const profile = pathsFor('a')
  const session = path.join(profile.sessions, 'broken')

  await fs.mkdir(session, { recursive: true })
  const filename = path.join(session, 'conversation_log.json')

  await fs.writeFile(filename, '{')
  await expect(migrateInferenceUsage(profile)).rejects.toThrow()
  expect(await usageRecords(profile)).toEqual([])
  expect(await fs.readdir(path.join(profile.logs, 'usage'))).toEqual([])

  await fs.writeFile(filename, JSON.stringify([{
    who: 'leon', sentAt: Date.parse('2026-10-01T12:00:00Z'),
    llmMetrics: { inputTokens: 10, outputTokens: 2 }
  }]))
  await migrateInferenceUsage(profile)
  expect(await usageRecords(profile)).toHaveLength(1)
})

it('runs migrations from oldest to newest UTC timestamp once per profile and discovers newly added IDs', async () => {
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
  const added = '2026093023595999-added.js'

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

it('recognizes completed migrations by their previous filenames without repeating their work', async () => {
  await fixture()
  const profile = pathsFor('a')
  const previousId = '20261001-original.js'

  await migration(FIRST, 'throw new Error(\'Completed work must not execute\')', [previousId])
  await migration(SECOND)
  await fs.writeFile(path.join(profile.root, RECEIPTS_FILENAME), JSON.stringify({
    completed: [previousId]
  }))

  expect(await runProfileMigrations(profile, migrationsPath)).toEqual([SECOND])
  expect(await completed(profile)).toEqual([FIRST, SECOND])
  expect(await fs.readFile(path.join(profile.root, 'trace'), 'utf8')).toBe(`${SECOND}\n`)
  expect(await runProfileMigrations(profile, migrationsPath)).toEqual([])
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

it('requires UTC timestamp filenames and a callable migration entry point', async () => {
  await fixture()
  const profile = pathsFor('a')

  for (const filename of [
    'undated.js',
    '20261001-date-only.js',
    '20261001202031020-milliseconds.js',
    '2026100120203102+0800-local-time.js'
  ]) {
    await migration(filename)
    await expect(runProfileMigrations(profile, migrationsPath))
      .rejects.toThrow('YYYYMMDDHHmmssSS-description.js in UTC')
    await fs.unlink(path.join(migrationsPath, filename))
  }

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
