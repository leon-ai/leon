import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  createStore,
  type CollectionConfig,
  type EmbedResult,
  type HybridQueryResult,
  type IndexStatus,
  type QMDStore,
  type SearchResult
} from '@tobilu/qmd'

export interface QMDCollectionDefinition {
  name: string
  dir: string
  pattern?: string
}

export type QMDSearchMode = 'query' | 'search'

export type QMDStoreRow = Record<string, unknown>

export class QMDWriteLockTimeoutError extends Error {
  public constructor(operation: string, lockPath: string) {
    super(`Timed out waiting for QMD ${operation} lock at ${lockPath}`)
    this.name = 'QMDWriteLockTimeoutError'
  }
}

const DEFAULT_PATTERN = '**/*.md'
const storePromises = new Map<string, Promise<QMDStore>>()
const writeChains = new Map<string, Promise<void>>()
const QMD_WRITE_LOCK_RETRY_MS = 250
const QMD_WRITE_LOCK_TIMEOUT_MS = 60_000
const QMD_WRITE_LOCK_STALE_MS = 15 * 60 * 1_000
const QMD_EMBED_SUBPROCESS_TIMEOUT_MS = 15 * 60 * 1_000
const QMD_EMBED_SUBPROCESS_MAX_BUFFER = 4 * 1024 * 1024

const execFileAsync = promisify(execFile)
const QMD_EMBED_WORKER_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'qmd-embed-worker.js'
)

interface QMDEmbedWorkerDiagnostics {
  status?: string
  stage?: string
  pid?: number
  updatedAt?: string
  result?: {
    docsProcessed?: number
    chunksEmbedded?: number
    errors?: number
    durationMs?: number
  }
  error?: {
    name?: string
    message?: string
    stack?: string | null
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getQMDDbPath(indexName: string): string {
  const cacheRoot = process.env['XDG_CACHE_HOME']
    ? path.join(process.env['XDG_CACHE_HOME'], 'qmd')
    : path.join(os.homedir(), '.cache', 'qmd')

  return path.join(cacheRoot, `${indexName}.sqlite`)
}

function getQMDWriteLockPath(indexName: string): string {
  return `${getQMDDbPath(indexName)}.write.lock`
}

function buildStoreConfig(
  collections: QMDCollectionDefinition[]
): CollectionConfig {
  return {
    collections: Object.fromEntries(
      collections.map((collection) => [
        collection.name,
        {
          path: collection.dir,
          pattern: collection.pattern || DEFAULT_PATTERN
        }
      ])
    )
  }
}

async function ensureCollectionDirectories(
  collections: QMDCollectionDefinition[]
): Promise<void> {
  const uniqueDirs = [...new Set(collections.map((collection) => collection.dir))]
  await Promise.all(
    uniqueDirs.map((dirPath) => fs.promises.mkdir(dirPath, { recursive: true }))
  )
}

async function ensureStoreRoot(indexName: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(getQMDDbPath(indexName)), {
    recursive: true
  })
}

function applyStoreDbPragmas(store: QMDStore): void {
  const db = store.internal?.db as { exec?: (sql: string) => unknown } | undefined
  if (!db?.exec) {
    return
  }

  try {
    db.exec('PRAGMA busy_timeout = 5000')
  } catch {
    // Ignore optional tuning failures. The store remains usable without this.
  }
}

async function storeHasRequiredCollections(
  store: QMDStore,
  collections: QMDCollectionDefinition[]
): Promise<boolean> {
  const requiredCollections = new Set(
    collections.map((collection) => collection.name).filter(Boolean)
  )
  if (requiredCollections.size === 0) {
    return true
  }

  const existingCollections = new Set(
    (await store.listCollections()).map((collection) => collection.name)
  )

  for (const collectionName of requiredCollections) {
    if (!existingCollections.has(collectionName)) {
      return false
    }
  }

  // Validate the persisted QMD collection config too, not only the collection
  // names. This lets Leon auto-heal when collection roots move, such as the
  // migration from the codebase `core/memory` folders into `~/.leon/profiles`.
  const db = store.internal?.db as {
    prepare?: (sql: string) => {
      all: () => Array<Record<string, unknown>>
    }
  } | undefined
  if (!db?.prepare) {
    return true
  }

  try {
    const rows = db
      .prepare(
        `SELECT name, path, pattern
         FROM store_collections`
      )
      .all()
    const existingConfigByName = new Map(
      rows.map((row) => [
        String(row['name'] || ''),
        {
          path: path.resolve(String(row['path'] || '')),
          pattern: String(row['pattern'] || DEFAULT_PATTERN)
        }
      ])
    )

    for (const collection of collections) {
      const existingConfig = existingConfigByName.get(collection.name)
      if (!existingConfig) {
        return false
      }

      const expectedPath = path.resolve(collection.dir)
      const expectedPattern = collection.pattern || DEFAULT_PATTERN
      if (
        existingConfig.path !== expectedPath ||
        existingConfig.pattern !== expectedPattern
      ) {
        return false
      }
    }
  } catch {
    return false
  }

  return true
}

async function closeStoreQuietly(store: QMDStore | null): Promise<void> {
  if (!store) {
    return
  }

  try {
    await store.close()
  } catch {
    // Ignore cleanup failures during fallback paths.
  }
}

async function maybeClearStaleWriteLock(lockPath: string): Promise<boolean> {
  try {
    const stats = await fs.promises.stat(lockPath)
    if (Date.now() - stats.mtimeMs <= QMD_WRITE_LOCK_STALE_MS) {
      return false
    }

    await fs.promises.unlink(lockPath)
    return true
  } catch {
    return false
  }
}

async function acquireQMDWriteLock(
  indexName: string,
  operation: string
): Promise<() => Promise<void>> {
  const lockPath = getQMDWriteLockPath(indexName)
  const startedAt = Date.now()

  while (true) {
    try {
      const handle = await fs.promises.open(lockPath, 'wx')
      try {
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            operation,
            createdAt: new Date().toISOString()
          }),
          'utf8'
        )
      } finally {
        await handle.close()
      }

      return async (): Promise<void> => {
        await fs.promises.unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') {
        throw error
      }

      const clearedStaleLock = await maybeClearStaleWriteLock(lockPath)
      if (clearedStaleLock) {
        continue
      }

      if (Date.now() - startedAt >= QMD_WRITE_LOCK_TIMEOUT_MS) {
        throw new QMDWriteLockTimeoutError(operation, lockPath)
      }

      await wait(QMD_WRITE_LOCK_RETRY_MS)
    }
  }
}

async function withQMDWriteLock<T>(
  indexName: string,
  operation: string,
  task: () => Promise<T>
): Promise<T> {
  const previousWrite = writeChains.get(indexName) || Promise.resolve()
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(async () => {
      const releaseLock = await acquireQMDWriteLock(indexName, operation)
      try {
        return await task()
      } finally {
        await releaseLock()
      }
    })
  const settledWrite = nextWrite.then(() => undefined, () => undefined)
  writeChains.set(indexName, settledWrite)

  try {
    return await nextWrite
  } finally {
    if (writeChains.get(indexName) === settledWrite) {
      writeChains.delete(indexName)
    }
  }
}

async function openExistingStore(indexName: string): Promise<QMDStore> {
  const store = await createStore({
    dbPath: getQMDDbPath(indexName)
  })
  applyStoreDbPragmas(store)
  return store
}

async function runQMDStoreEmbedInSubprocess(params: {
  indexName: string
  force?: boolean
}): Promise<EmbedResult> {
  const outputDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'leon-qmd-embed-')
  )
  const payloadPath = path.join(outputDir, 'payload.json')
  const outputPath = path.join(outputDir, 'result.json')
  const diagnosticsPath = path.join(outputDir, 'diagnostics.json')

  await fs.promises.writeFile(
    payloadPath,
    JSON.stringify({
      dbPath: getQMDDbPath(params.indexName),
      options:
        typeof params.force === 'boolean'
          ? { force: params.force }
          : {}
    }),
    'utf8'
  )

  try {
    await execFileAsync(
      process.execPath,
      [QMD_EMBED_WORKER_PATH, payloadPath, outputPath, diagnosticsPath],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: QMD_EMBED_SUBPROCESS_TIMEOUT_MS,
        maxBuffer: QMD_EMBED_SUBPROCESS_MAX_BUFFER
      }
    )

    const output = await fs.promises.readFile(outputPath, 'utf8')
    const parsed = JSON.parse(output || '{}') as {
      result?: EmbedResult
    }
    if (!parsed.result) {
      throw new Error('QMD embed subprocess returned no result')
    }

    return parsed.result
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer
      stderr?: string | Buffer
      signal?: NodeJS.Signals
      code?: number | string
      killed?: boolean
    }
    const stdout = execError.stdout ? execError.stdout.toString() : ''
    const stderr = execError.stderr ? execError.stderr.toString() : ''
    const exitCode =
      typeof execError.code === 'number' ? ` exit_code=${execError.code}` : ''
    const signal = execError.signal ? ` signal=${execError.signal}` : ''
    const timeout = execError.killed ? ' timed_out=true' : ''
    let diagnosticsSummary = ''

    try {
      const diagnostics = JSON.parse(
        await fs.promises.readFile(diagnosticsPath, 'utf8')
      ) as QMDEmbedWorkerDiagnostics
      const diagnosticsParts = [
        diagnostics.status ? `worker_status=${diagnostics.status}` : '',
        diagnostics.stage ? `worker_stage=${diagnostics.stage}` : '',
        diagnostics.error?.name ? `worker_error=${diagnostics.error.name}` : '',
        diagnostics.error?.message
          ? `worker_message=${JSON.stringify(diagnostics.error.message)}`
          : ''
      ].filter(Boolean)

      if (diagnosticsParts.length > 0) {
        diagnosticsSummary = ` ${diagnosticsParts.join(' ')}`
      }
    } catch {
      // Ignore diagnostics read failures; process-level details still help.
    }

    const details = [stdout.trim(), stderr.trim()]
      .filter(Boolean)
      .join(' | ')

    throw new Error(
      `QMD embed subprocess failed.${exitCode}${signal}${timeout}${diagnosticsSummary}${
        details ? ` ${details}` : ''
      }`
    )
  } finally {
    await fs.promises.rm(outputDir, { recursive: true, force: true })
  }
}

async function openConfiguredStore(
  indexName: string,
  collections: QMDCollectionDefinition[]
): Promise<QMDStore> {
  const store = await createStore({
    dbPath: getQMDDbPath(indexName),
    config: buildStoreConfig(collections)
  })
  applyStoreDbPragmas(store)
  return store
}

function inferCollectionName(
  filepath: string,
  displayPath: string
): string {
  const qmdPathMatch = filepath.match(/^qmd:\/\/([^/]+)\//i)
  if (qmdPathMatch?.[1]) {
    return qmdPathMatch[1]
  }

  const [firstDisplaySegment] = displayPath.split('/')
  return firstDisplaySegment || ''
}

function toStoreRow(result: SearchResult | HybridQueryResult): QMDStoreRow {
  const filepath = 'filepath' in result ? result.filepath : result.file
  const collectionName =
    'collectionName' in result
      ? result.collectionName
      : inferCollectionName(filepath, result.displayPath)
  const content =
    'bestChunk' in result
      ? result.bestChunk || result.body
      : result.body || ''

  return {
    filepath,
    path: filepath,
    file: filepath,
    source: filepath,
    title: result.title,
    name: result.title,
    content,
    body: content,
    snippet: content,
    context: result.context || null,
    docid: result.docid,
    id: result.docid,
    collection: collectionName,
    collection_name: collectionName,
    collectionName,
    score: result.score
  }
}

export async function getQMDStore(
  indexName: string,
  collections: QMDCollectionDefinition[]
): Promise<QMDStore> {
  const existingStorePromise = storePromises.get(indexName)
  if (existingStorePromise) {
    return existingStorePromise
  }

  const createStorePromise = async (): Promise<QMDStore> => {
    await ensureStoreRoot(indexName)
    await ensureCollectionDirectories(collections)
    const dbPath = getQMDDbPath(indexName)

    try {
      await fs.promises.access(dbPath, fs.constants.F_OK)
      const existingStore = await openExistingStore(indexName)
      if (await storeHasRequiredCollections(existingStore, collections)) {
        return existingStore
      }
      await closeStoreQuietly(existingStore)
    } catch {
      // Fall through to configured creation.
    }

    return withQMDWriteLock(indexName, 'configure', async () => {
      try {
        await fs.promises.access(dbPath, fs.constants.F_OK)
        const existingStore = await openExistingStore(indexName)
        if (await storeHasRequiredCollections(existingStore, collections)) {
          return existingStore
        }
        await closeStoreQuietly(existingStore)
      } catch {
        // Continue with configured creation when DB is missing or incomplete.
      }

      return openConfiguredStore(indexName, collections)
    })
  }
  const storePromise = createStorePromise()

  storePromises.set(indexName, storePromise)

  try {
    return await storePromise
  } catch (error) {
    storePromises.delete(indexName)
    throw error
  }
}

export async function runQMDStoreSearch(params: {
  indexName: string
  collections: QMDCollectionDefinition[]
  mode: QMDSearchMode
  query: string
  collectionNames: string[]
  limit: number
}): Promise<QMDStoreRow[]> {
  const normalizedQuery = params.query.trim()
  if (!normalizedQuery) {
    return []
  }

  const collectionNames = [...new Set(params.collectionNames)].filter(Boolean)
  if (collectionNames.length === 0) {
    return []
  }

  const store = await getQMDStore(params.indexName, params.collections)

  if (params.mode === 'query') {
    const results = await store.search({
      query: normalizedQuery,
      collections: collectionNames,
      limit: params.limit
    })

    return results.map((result) => toStoreRow(result))
  }

  const searchResults = await Promise.all(
    collectionNames.map((collectionName) =>
      store.searchLex(normalizedQuery, {
        collection: collectionName,
        limit: params.limit
      })
    )
  )

  return searchResults.flat().map((result) => toStoreRow(result))
}

export async function updateQMDStore(params: {
  indexName: string
  collections: QMDCollectionDefinition[]
  collectionNames?: string[]
}): Promise<void> {
  const store = await getQMDStore(params.indexName, params.collections)
  await withQMDWriteLock(params.indexName, 'update', async () => {
    const updateOptions =
      params.collectionNames && params.collectionNames.length > 0
        ? { collections: params.collectionNames }
        : {}

    await store.update(updateOptions)
  })
}

export async function getQMDStoreStatus(params: {
  indexName: string
  collections: QMDCollectionDefinition[]
}): Promise<IndexStatus> {
  const store = await getQMDStore(params.indexName, params.collections)
  return store.getStatus()
}

export async function embedQMDStore(params: {
  indexName: string
  collections: QMDCollectionDefinition[]
  force?: boolean
}): Promise<EmbedResult> {
  await getQMDStore(params.indexName, params.collections)
  return withQMDWriteLock(params.indexName, 'embed', async () => {
    return runQMDStoreEmbedInSubprocess({
      indexName: params.indexName,
      ...(typeof params.force === 'boolean' ? { force: params.force } : {})
    })
  })
}

export async function closeQMDStore(indexName: string): Promise<void> {
  const storePromise = storePromises.get(indexName)
  if (!storePromise) {
    return
  }

  storePromises.delete(indexName)

  try {
    const store = await storePromise
    await store.close()
  } catch {
    // Ignore close failures during teardown.
  }
}
