import fs from 'node:fs/promises'

import { createStore } from '@tobilu/qmd'

const [, , payloadPath, outputPath, diagnosticsPath] = process.argv

async function writeDiagnostics(partial) {
  if (!diagnosticsPath) {
    return
  }

  let current = {}
  try {
    const existing = await fs.readFile(diagnosticsPath, 'utf8')
    current = JSON.parse(existing)
  } catch {
    current = {}
  }

  await fs.writeFile(
    diagnosticsPath,
    JSON.stringify(
      {
        ...current,
        ...partial,
        updatedAt: new Date().toISOString(),
        pid: process.pid
      },
      null,
      2
    ),
    'utf8'
  )
}

async function reportFatal(kind, error) {
  await writeDiagnostics({
    status: kind,
    stage: 'fatal',
    error: error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack || null
        }
      : {
          name: 'UnknownError',
          message: String(error),
          stack: null
        }
  })
}

process.on('uncaughtException', (error) => {
  reportFatal('uncaughtException', error)
    .catch(() => undefined)
    .finally(() => {
      process.exit(101)
    })
})

process.on('unhandledRejection', (reason) => {
  reportFatal('unhandledRejection', reason)
    .catch(() => undefined)
    .finally(() => {
      process.exit(102)
    })
})

if (!payloadPath || !outputPath) {
  throw new Error('Missing QMD embed worker arguments')
}

await writeDiagnostics({
  status: 'starting',
  stage: 'bootstrap'
})

const payload = JSON.parse(await fs.readFile(payloadPath, 'utf8'))
const signal = AbortSignal.timeout(payload.maxDurationMs)

await writeDiagnostics({
  status: 'running',
  stage: 'store_open'
})

const store = await createStore({
  dbPath: payload.dbPath
})

try {
  await writeDiagnostics({
    status: 'running',
    stage: 'embed'
  })

  const result = await store.embed({ force: payload.force, signal })

  await fs.writeFile(outputPath, JSON.stringify({ result }), 'utf8')
  await writeDiagnostics({
    status: 'completed',
    stage: 'done',
    result: {
      docsProcessed: result.docsProcessed,
      chunksEmbedded: result.chunksEmbedded,
      errors: result.errors,
      durationMs: result.durationMs
    }
  })
} finally {
  await writeDiagnostics({
    stage: 'closing'
  })
  await store.close()
}
