import type { MessageLog } from '@/types'

const SUMMARY_MAX_CHARS = 900

function cleanText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .replace(/^```(?:text|md|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/\r/g, '')
    .trim()
}

function clampSummary(value: string): string {
  const normalized = value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()

  if (!normalized) {
    return ''
  }

  if (normalized.length <= SUMMARY_MAX_CHARS) {
    return normalized
  }

  return normalized.slice(0, SUMMARY_MAX_CHARS).trimEnd()
}

function toTopicBullets(value: string): string {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => (line.startsWith('- ') ? line : `- ${line}`))

  return clampSummary(lines.join('\n'))
}

function normalizeLegacySummaryObject(value: Record<string, unknown>): string {
  const lines: string[] = []
  const goal = cleanText(value['goal'])

  if (goal) {
    lines.push(goal)
  }

  const sections: Array<[string, unknown]> = [
    ['facts', value['facts']],
    ['decisions', value['decisions']],
    ['constraints', value['constraints']],
    ['pending', value['pending']],
    ['artifacts', value['artifacts']],
    ['entities', value['entities']]
  ]

  for (const [, rawItems] of sections) {
    if (!Array.isArray(rawItems)) {
      continue
    }

    const items = rawItems
      .map((item) => cleanText(item))
      .filter((item) => item.length > 0)

    lines.push(...items)
  }

  return toTopicBullets(lines.join('\n'))
}

export function normalizeHistoryCompactionSummary(output: unknown): string | null {
  if (typeof output === 'string') {
    const normalized = toTopicBullets(cleanText(output))
    return normalized || null
  }

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const normalized = normalizeLegacySummaryObject(
      output as Record<string, unknown>
    )
    return normalized || null
  }

  return null
}

export function hasHistoryCompactionContent(summary: string | null): boolean {
  return Boolean(summary && summary.trim())
}

export function formatHistoryForCompaction(
  previousSummary: string | null,
  logs: MessageLog[]
): string {
  const lines = logs.map((log, index) => {
    const speaker = log.who === 'owner' ? 'Owner' : 'Leon'
    const message = cleanText(log.message)

    return `${index + 1}. ${speaker}: ${message}`
  })

  return [
    'Current compacted summary:',
    previousSummary?.trim() || '(none)',
    '',
    'Older raw messages to absorb:',
    lines.length > 0 ? lines.join('\n') : '(none)',
    '',
    'Rewrite the summary as short plain text topic bullets.',
    'A single topic may be spread across multiple messages; merge related messages into one concise bullet.',
    'Each bullet should capture one topic and the key data that still matters.',
    'Keep only information needed to continue correctly.',
    'Do not use section headings or category labels.',
    'No intro. No code fences.'
  ].join('\n')
}

export function buildCompactedHistoryMessage(summary: string): string {
  return `Earlier conversation summary:\n${summary.trim()}`
}

function isSameMessageLog(left: MessageLog, right: MessageLog): boolean {
  return (
    left.who === right.who &&
    left.sentAt === right.sentAt &&
    left.message === right.message
  )
}

export function findMessageSequenceStart(
  logs: MessageLog[],
  sequence: MessageLog[]
): number {
  if (sequence.length === 0 || sequence.length > logs.length) {
    return -1
  }

  for (let start = logs.length - sequence.length; start >= 0; start -= 1) {
    let matched = true

    for (let index = 0; index < sequence.length; index += 1) {
      if (!isSameMessageLog(logs[start + index]!, sequence[index]!)) {
        matched = false
        break
      }
    }

    if (matched) {
      return start
    }
  }

  return -1
}
