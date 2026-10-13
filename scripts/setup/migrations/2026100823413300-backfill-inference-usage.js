import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

import {
  HISTORICAL_USAGE_FILENAME,
  USAGE_DIRECTORY,
  readInferenceUsage
} from '@/core/llm-manager/llm-usage/usage-ledger'
import { readProviderUsage } from '@/core/llm-manager/llm-usage/usage-context'
import { readUsageAccounting } from '@/core/llm-manager/llm-usage/usage-accounting'
import { createInferenceMetadata } from '@/core/llm-manager/inference-metadata'

export const previousIds = ['20261009-backfill-inference-usage.js']

const CONVERSATION_FILENAME = 'conversation_log.json'
const UNKNOWN_ROUTE = 'unknown'

async function readConversation(filename) {
  let content

  try {
    content = await fs.readFile(filename, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }

    throw error
  }

  const messages = JSON.parse(content)

  if (!Array.isArray(messages)) {
    throw new Error(`Invalid conversation history: ${filename}.`)
  }

  return messages
}

/**
 * Retain saved counters and attribution at their original turn-level granularity.
 */
function historicalRecord(message, sessionId) {
  if (
    message?.who !== 'leon' || !Number.isFinite(message.sentAt) ||
    !Number.isFinite(new Date(message.sentAt).getTime())
  ) {
    return null
  }

  const metrics = message.llmMetrics ?? message.agentResponseTrace?.metrics
  const usage = readProviderUsage(metrics)

  if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
    return null
  }

  const accounting = readUsageAccounting(metrics?.usageAccounting)

  if (accounting?.cacheReadCompletionCount > 0) {
    usage.cachedInputTokens = accounting.cachedInputTokens
  }
  if (accounting?.cacheWriteInputTokens > 0) {
    usage.cacheWriteInputTokens = accounting.cacheWriteInputTokens
  }
  if (accounting?.costCompletionCount > 0 && accounting.estimatedCostCompletionCount === 0) {
    usage.costUSD = accounting.costUSD
  }

  const routes = Array.isArray(message.inference)
    ? message.inference : message.inference ? [message.inference] : []
  const route = routes.length === 1 ? routes[0] : null
  const inference = route ? {
    ...createInferenceMetadata(route),
    ...(route.connectionRef ? { connectionRef: route.connectionRef } : {})
  } : undefined
  const completionCount = Number.isSafeInteger(metrics?.completionCount) && metrics.completionCount > 0
    ? metrics.completionCount : undefined
  // Copied legacy conversations and session branches refer to the same completed turn.
  const identity = typeof message.messageId === 'string' && message.messageId
    ? message.messageId : JSON.stringify([message.sentAt, message.message])

  return {
    id: `history-${createHash('sha256').update(identity).digest('hex')}`,
    startedAt: message.sentAt,
    finishedAt: message.sentAt,
    sessionId,
    provider: route?.provider || UNKNOWN_ROUTE,
    model: route?.model || UNKNOWN_ROUTE,
    purpose: 'react',
    outcome: 'unknown',
    ...(inference ? { inference } : {}),
    usage,
    historical: {
      ...(completionCount !== undefined ? { completionCount } : {}),
      ...(accounting ? { accounting } : {})
    }
  }
}

/**
 * Preserve saved turn totals without inventing individual requests or routes.
 * Publish history separately so retries cannot duplicate it or rewrite live usage.
 * @param {import('@/core/profile-runtime/profile-paths').ProfilePaths} profilePaths
 */
export default async function migrate(profilePaths) {
  const directory = path.join(profilePaths.logs, USAGE_DIRECTORY)
  const destination = path.join(directory, HISTORICAL_USAGE_FILENAME)

  try {
    await fs.access(destination)
    return
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }

  let cutoff = Infinity

  for await (const record of readInferenceUsage({}, profilePaths)) {
    cutoff = Math.min(cutoff, record.startedAt)
  }

  const sessions = await fs.readdir(profilePaths.sessions, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') {
      return []
    }

    throw error
  })
  const sources = sessions.filter((session) => session.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((session) => ({
      sessionId: session.name,
      filename: path.join(profilePaths.sessions, session.name, CONVERSATION_FILENAME)
    }))

  sources.push({ sessionId: null, filename: path.join(profilePaths.root, CONVERSATION_FILENAME) })

  await fs.mkdir(directory, { recursive: true })
  const temporary = `${destination}.${randomUUID()}.tmp`
  const imported = new Set()

  try {
    const file = await fs.open(temporary, 'wx', 0o600)

    try {
      for (const source of sources) {
        const messages = await readConversation(source.filename)

        for (const message of messages) {
          const record = historicalRecord(message, source.sessionId)

          // Once per-attempt tracking begins, turn summaries overlap its counters.
          if (!record || record.finishedAt >= cutoff || imported.has(record.id)) {
            continue
          }

          await file.writeFile(`${JSON.stringify(record)}\n`)
          imported.add(record.id)
        }
      }

      await file.sync()
    } finally {
      await file.close()
    }

    // An interrupted setup can retry after publication without adding history twice.
    await fs.link(temporary, destination).catch((error) => {
      if (error.code !== 'EEXIST') {
        throw error
      }
    })
  } finally {
    await fs.rm(temporary, { force: true })
  }
}
