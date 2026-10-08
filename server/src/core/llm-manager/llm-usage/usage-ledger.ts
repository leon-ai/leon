import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import type { InferenceMetadata } from '../inference-metadata'
import type { InferenceUsage } from './usage-context'

const USAGE_DIRECTORY = 'usage'
const USAGE_FILE_EXTENSION = '.jsonl'

export interface InferenceUsageRecord {
  id: string
  startedAt: number
  finishedAt: number
  sessionId: string | null
  provider: string
  model: string
  purpose: string
  outcome: string
  inference?: InferenceMetadata
  usage: InferenceUsage
}

export interface InferenceUsageQuery {
  from?: number
  until?: number
  sessionId?: string
}

function usageDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

/**
 * Appends content-free accounting independently of conversation retention.
 * UTC daily files bound date-range reads; summaries apply the owner's time zone.
 */
export async function appendInferenceUsage(
  profileName: string,
  record: InferenceUsageRecord
): Promise<void> {
  const directory = path.join(getProfilePaths(profileName).logs, USAGE_DIRECTORY)

  await fs.promises.mkdir(directory, { recursive: true })
  await fs.promises.appendFile(
    path.join(directory, `${usageDay(record.startedAt)}${USAGE_FILE_EXTENSION}`),
    `${JSON.stringify(record)}\n`,
    'utf8'
  )
}

/**
 * Streams only the selected profile's records without loading the ledger in memory.
 */
export async function* readInferenceUsage(
  query: InferenceUsageQuery
): AsyncGenerator<InferenceUsageRecord> {
  const directory = path.join(getProfilePaths().logs, USAGE_DIRECTORY)
  let files: string[]

  try {
    files = await fs.promises.readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }

    throw error
  }

  for (const file of files.sort()) {
    if (!file.endsWith(USAGE_FILE_EXTENSION)) {
      continue
    }

    const day = file.slice(0, -USAGE_FILE_EXTENSION.length)

    if (
      (query.from !== undefined && day < usageDay(query.from)) ||
      (query.until !== undefined && day > usageDay(query.until - 1))
    ) {
      continue
    }

    const stream = fs.createReadStream(path.join(directory, file), { encoding: 'utf8' })
    const lines = createInterface({ input: stream, crlfDelay: Infinity })

    try {
      for await (const line of lines) {
        if (!line.trim()) {
          continue
        }

        // A damaged record must remain visible as a reporting failure, not lost usage.
        const record = JSON.parse(line) as InferenceUsageRecord

        if (
          (query.from !== undefined && record.startedAt < query.from) ||
          (query.until !== undefined && record.startedAt >= query.until) ||
          (query.sessionId !== undefined && record.sessionId !== query.sessionId)
        ) {
          continue
        }

        yield record
      }
    } finally {
      lines.close()
      stream.destroy()
    }
  }
}
