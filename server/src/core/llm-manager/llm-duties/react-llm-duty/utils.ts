import { LogHelper } from '@/helpers/log-helper'

import type {
  PlanStep,
  ExecutionRecord,
  PlanResult,
  FinalPhaseIntent
} from './types'

type ExecutionHistoryFormatMode = 'compact' | 'complete'

const COMPACT_EXECUTION_HISTORY_MAX_DETAILED_STEPS = 6
const STRUCTURED_SUMMARY_PRIORITIES = [
  'content',
  'snippet',
  'text',
  'summary',
  'description',
  'title',
  'answer',
  'hits',
  'files',
  'results',
  'items',
  'query',
  'filename',
  'location',
  'sourcePath'
]

export const formatFilePath = (filePath: string): string => {
  return `[FILE_PATH]${filePath}[/FILE_PATH]`
}

function clipText(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`
}

function clipMultilineText(
  value: string,
  maxLength: number,
  maxLines: number
): string {
  const normalized = value.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return ''
  }

  const lines = normalized.split('\n')
  const clippedLines = lines.slice(0, maxLines)
  let output = clippedLines.join('\n')
  let wasTruncated = lines.length > maxLines

  if (output.length > maxLength) {
    output = `${output.slice(0, maxLength - 3).trimEnd()}...`
    wasTruncated = true
  }

  if (!wasTruncated) {
    return output
  }

  return output.endsWith('...') ? output : `${output}\n...`
}

function summarizeScalar(
  value: unknown,
  mode: ExecutionHistoryFormatMode = 'compact'
): string | null {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return clipText(String(value))
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/\r\n/g, '\n').trim()
    if (!normalized) {
      return null
    }

    if (!normalized.includes('\n')) {
      return clipText(normalized, mode === 'complete' ? 320 : 180)
    }

    return clipMultilineText(
      normalized,
      mode === 'complete' ? 4_000 : 700,
      mode === 'complete' ? 120 : 16
    )
  }

  return null
}

function pickRepresentativeText(record: Record<string, unknown>): string | null {
  for (const key of STRUCTURED_SUMMARY_PRIORITIES) {
    const value = summarizeScalar(record[key])
    if (value) {
      return value
    }
  }

  for (const value of Object.values(record)) {
    const scalar = summarizeScalar(value)
    if (scalar) {
      return scalar
    }
  }

  return null
}

function getStructuredSummaryPriority(key: string): number {
  const priority = STRUCTURED_SUMMARY_PRIORITIES.indexOf(key)

  return priority === -1 ? Number.MAX_SAFE_INTEGER : priority
}

function summarizeArrayField(
  key: string,
  value: unknown[],
  mode: ExecutionHistoryFormatMode
): string | null {
  if (value.length === 0) {
    return `${key}=0`
  }

  const objectItems = value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  )

  if (objectItems.length > 0) {
    const preview = objectItems
      .slice(0, 2)
      .map((item) => pickRepresentativeText(item))
      .filter((item): item is string => Boolean(item))
      .join(' ; ')

    return preview
      ? `${key}(${value.length}): ${preview}`
      : `${key}=${value.length}`
  }

    const scalarPreview = value
    .map((item) => summarizeScalar(item, mode))
    .filter((item): item is string => Boolean(item))
    .slice(0, 3)
    .join(', ')

  return scalarPreview
    ? `${key}(${value.length}): ${scalarPreview}`
    : `${key}=${value.length}`
}

function summarizeObjectField(
  key: string,
  value: Record<string, unknown>,
  mode: ExecutionHistoryFormatMode
): string | null {
  const preferredSummary = pickRepresentativeText(value)
  if (preferredSummary) {
    return `${key}: ${preferredSummary}`
  }

  const entries = Object.entries(value)
    .map(([childKey, childValue]) => {
      const scalar = summarizeScalar(childValue, mode)
      return scalar ? `${childKey}=${scalar}` : null
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 3)

  if (entries.length === 0) {
    return null
  }

  return `${key}: ${entries.join(', ')}`
}

function summarizeStructuredPayload(
  payload: unknown,
  mode: ExecutionHistoryFormatMode = 'compact'
): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const scalar = summarizeScalar(payload, mode)
    return scalar ? [scalar] : []
  }

  const summaries: string[] = []

  const orderedEntries = Object.entries(payload).sort(
    ([leftKey], [rightKey]) => {
      return (
        getStructuredSummaryPriority(leftKey) -
        getStructuredSummaryPriority(rightKey)
      )
    }
  )

  for (const [key, value] of orderedEntries) {
    if (summaries.length >= 6) {
      break
    }

    const scalar = summarizeScalar(value, mode)
    if (scalar) {
      summaries.push(
        scalar.includes('\n') ? `${key}:\n${scalar}` : `${key}=${scalar}`
      )
      continue
    }

    if (Array.isArray(value)) {
      const arraySummary = summarizeArrayField(key, value, mode)
      if (arraySummary) {
        summaries.push(arraySummary)
      }
      continue
    }

    if (value && typeof value === 'object') {
      const objectSummary = summarizeObjectField(
        key,
        value as Record<string, unknown>,
        mode
      )
      if (objectSummary) {
        summaries.push(objectSummary)
      }
    }
  }

  return summaries
}

function extractObservationPayload(
  parsed: Record<string, unknown>
): unknown {
  const data = parsed['data']
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null
  }

  const output = (data as Record<string, unknown>)['output']
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return data
  }

  const outputRecord = output as Record<string, unknown>
  const result = outputRecord['result']
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const resultRecord = result as Record<string, unknown>
    const nestedData = resultRecord['data']
    if (nestedData && typeof nestedData === 'object' && !Array.isArray(nestedData)) {
      return nestedData
    }

    return resultRecord
  }

  const nestedData = outputRecord['data']
  if (nestedData && typeof nestedData === 'object' && !Array.isArray(nestedData)) {
    return nestedData
  }

  return outputRecord
}

function formatObservationSummary(
  observation: string,
  mode: ExecutionHistoryFormatMode = 'compact'
): string {
  const parsed = parseToolCallArguments(observation)
  if (!parsed) {
    if (mode === 'complete') {
      return clipMultilineText(observation, 4_000, 120)
    }

    return clipText(observation, 320)
  }

  const parts: string[] = []
  const status =
    typeof parsed['status'] === 'string' ? parsed['status'].trim() : ''
  const message =
    typeof parsed['message'] === 'string' ? clipText(parsed['message'], 160) : ''

  if (status) {
    parts.push(status)
  }

  if (message) {
    parts.push(message)
  }

  const toolFailure =
    parsed['tool_output_failure'] &&
    typeof parsed['tool_output_failure'] === 'object' &&
    !Array.isArray(parsed['tool_output_failure'])
      ? (parsed['tool_output_failure'] as Record<string, unknown>)
      : null
  const toolFailureError =
    toolFailure && typeof toolFailure['error'] === 'string'
      ? clipText(toolFailure['error'] as string, 160)
      : ''

  if (toolFailureError && !parts.includes(toolFailureError)) {
    parts.push(toolFailureError)
  }

  const payloadSummary = summarizeStructuredPayload(
    extractObservationPayload(parsed),
    mode
  )
  if (payloadSummary.length > 0) {
    parts.push(...payloadSummary)
  }

  const summary = parts.some((part) => part.includes('\n'))
    ? parts.join('\n')
    : parts.join(' | ')

  if (mode === 'complete') {
    return clipMultilineText(summary, 6_000, 160)
  }

  return clipText(summary.replace(/\s*\n\s*/g, ' | '), 700)
}

/**
 * Determines whether a catalog entry refers to a tool (toolkit.tool) rather
 * than a fully-qualified function (toolkit.tool.function).
 */
export const isToolLevel = (qualifiedName: string): boolean => {
  return qualifiedName.split('.').length <= 2
}

function parseFinalIntent(
  value: unknown,
  fallback: FinalPhaseIntent = 'answer'
): FinalPhaseIntent {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : ''
  switch (normalized) {
    case 'answer':
    case 'clarification':
    case 'cancelled':
    case 'blocked':
    case 'error':
      return normalized
    default:
      return fallback
  }
}

function indentBlock(value: string, prefix: string): string {
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function formatExecutionEntry(
  execution: ExecutionRecord,
  index: number,
  mode: ExecutionHistoryFormatMode
): string {
  const observationSummary = formatObservationSummary(
    execution.observation,
    mode
  )
  const resultSection = observationSummary.includes('\n')
    ? `\n  Result:\n${indentBlock(observationSummary, '    ')}`
    : `\n  Result: ${observationSummary}`

  return `Step ${index + 1}: ${execution.function} [${execution.status}]${
    execution.stepLabel ? ` | Label: "${execution.stepLabel}"` : ''
  }${
    execution.requestedToolInput
      ? `\n  Input: ${clipText(execution.requestedToolInput, 220)}`
      : ''
  }${resultSection}`
}

function formatOlderExecutionSummary(history: ExecutionRecord[]): string {
  const statusCounts = history.reduce<Record<string, number>>((counts, execution) => {
    const status = execution.status || 'unknown'
    counts[status] = (counts[status] || 0) + 1
    return counts
  }, {})
  const statusSummary = Object.entries(statusCounts)
    .map(([status, count]) => `${status}=${count}`)
    .join(', ')

  const notableSteps = [
    ...new Set(
      history
        .slice(-3)
        .map((execution) => execution.stepLabel || execution.function)
        .map((value) => value.trim())
        .filter((value) => Boolean(value))
    )
  ]
  const notableSummary =
    notableSteps.length > 0
      ? ` | recent earlier steps: ${clipText(notableSteps.join(' ; '), 180)}`
      : ''

  return `Earlier Steps: ${history.length} summarized${statusSummary ? ` | ${statusSummary}` : ''}${notableSummary}`
}

export function formatExecutionHistory(
  history: ExecutionRecord[],
  mode: ExecutionHistoryFormatMode = 'compact'
): string {
  if (history.length === 0) {
    return 'Previous Executions: none'
  }

  const renderedEntries: string[] = []

  if (
    mode === 'compact' &&
    history.length > COMPACT_EXECUTION_HISTORY_MAX_DETAILED_STEPS
  ) {
    const detailedStartIndex =
      history.length - COMPACT_EXECUTION_HISTORY_MAX_DETAILED_STEPS
    const olderHistory = history.slice(0, detailedStartIndex)
    const recentHistory = history.slice(detailedStartIndex)

    renderedEntries.push(formatOlderExecutionSummary(olderHistory))
    renderedEntries.push(
      ...recentHistory.map((execution, offset) =>
        formatExecutionEntry(
          execution,
          detailedStartIndex + offset,
          mode
        )
      )
    )
  } else {
    renderedEntries.push(
      ...history.map((execution, index) =>
        formatExecutionEntry(execution, index, mode)
      )
    )
  }

  return `Previous Executions:\n${renderedEntries.join('\n')}`
}

/**
 * Parses plan steps from raw tool call arguments (array of objects).
 * Handles missing labels gracefully.
 */
export function parseStepsFromArgs(
  rawSteps: Record<string, unknown>[]
): PlanStep[] {
  return rawSteps
    .filter(
      (s) =>
        typeof s['function'] === 'string' &&
        (s['function'] as string).trim()
    )
    .map((s) => ({
      function: (s['function'] as string).trim(),
      label:
        typeof s['label'] === 'string' && (s['label'] as string).trim()
          ? (s['label'] as string).trim()
          : (s['function'] as string).trim(),
      ...(
        typeof s['agent_skill_id'] === 'string' &&
        (s['agent_skill_id'] as string).trim()
          ? { agentSkillId: (s['agent_skill_id'] as string).trim() }
          : {}
      )
    }))
}

/**
 * Extracts a plan or final answer from a parsed output object.
 * Handles the common patterns: type=plan with steps, type=final with answer,
 * and the fallback of extracting function references from the summary.
 */
export function extractPlanFromParsed(
  parsed: Record<string, unknown> | null,
  source: 'planning' | 'recovery' = 'planning'
): PlanResult | null {
  if (!parsed) {
    return null
  }

  if (parsed['type'] === 'final' && parsed['answer']) {
    const answer = String(parsed['answer']).trim()
    if (!answer) {
      return null
    }
    return {
      type: 'handoff',
      signal: {
        intent: parseFinalIntent(parsed['intent']),
        draft: answer,
        source
      }
    }
  }

  if (
    parsed['type'] === 'handoff' &&
    typeof parsed['intent'] === 'string' &&
    parsed['draft']
  ) {
    const draft = String(parsed['draft']).trim()
    if (!draft) {
      return null
    }
    return {
      type: 'handoff',
      signal: {
        intent: parseFinalIntent(parsed['intent']),
        draft,
        source
      }
    }
  }

  if (parsed['type'] === 'plan') {
    let steps: PlanStep[] = []

    if (
      Array.isArray(parsed['steps']) &&
      (parsed['steps'] as unknown[]).length > 0
    ) {
      steps = parseStepsFromArgs(
        parsed['steps'] as Record<string, unknown>[]
      )
    }

    // If steps array is empty but the summary mentions function references
    // (common with local/smaller models), extract them from the summary
    if (steps.length === 0) {
      const summary =
        typeof parsed['summary'] === 'string'
          ? (parsed['summary'] as string)
          : ''

      if (summary) {
        LogHelper.title('ReAct LLM Duty')
        LogHelper.debug(
          'Planning: steps array is empty, attempting to extract functions from summary'
        )

        const functionPattern = /([a-z_]+\.[a-z_]+\.[a-zA-Z_]+)/g
        const matches = summary.match(functionPattern)
        if (matches) {
          steps = [...new Set(matches)].map((fn) => ({
            function: fn,
            label: fn
          }))
          LogHelper.debug(
            `Extracted ${steps.length} function(s) from summary: ${steps.map((s) => s.function).join(', ')}`
          )
        }
      }
    }

    if (steps.length > 0) {
      const summary =
        typeof parsed['summary'] === 'string'
          ? (parsed['summary'] as string)
          : ''
      return { type: 'plan', steps, summary }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

/**
 * Parses raw LLM output into a structured object, handling both JSON
 * objects from structured output and string responses from remote providers.
 */
export function parseOutput(
  rawOutput: unknown
): Record<string, unknown> | null {
  if (!rawOutput) {
    return null
  }

  if (typeof rawOutput === 'object' && !Array.isArray(rawOutput)) {
    return rawOutput as Record<string, unknown>
  }

  if (typeof rawOutput !== 'string') {
    return null
  }

  const trimmed = rawOutput.trim()
  if (!trimmed) {
    return null
  }

  // Try tagged JSON
  const taggedJson = extractTaggedJson(trimmed)
  if (taggedJson) {
    try {
      return JSON.parse(taggedJson)
    } catch {
      // Continue
    }
  }

  // Try direct JSON parse
  try {
    return JSON.parse(trimmed)
  } catch {
    // Continue
  }

  // Try extracting JSON substring
  const extracted = extractJsonSubstring(trimmed)
  if (extracted) {
    try {
      const parsed = JSON.parse(extracted)
      if (Array.isArray(parsed)) {
        const first = parsed[0]
        if (first && typeof first === 'object') {
          return first as Record<string, unknown>
        }
        return null
      }
      return parsed
    } catch {
      // Continue
    }
  }

  return null
}

export function parseToolCallArguments(
  rawArguments: string
): Record<string, unknown> | null {
  if (!rawArguments || typeof rawArguments !== 'string') {
    return null
  }

  const trimmed = rawArguments.trim()
  if (!trimmed) {
    return null
  }

  const candidates: string[] = [trimmed]
  const strippedCodeFence = trimmed
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()

  if (strippedCodeFence && strippedCodeFence !== trimmed) {
    candidates.push(strippedCodeFence)
  }

  const extracted = extractJsonSubstring(strippedCodeFence)
  if (extracted && !candidates.includes(extracted)) {
    candidates.push(extracted)
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Continue with next candidate
    }
  }

  return null
}

export function extractPlanResultFromCreatePlanArgs(
  parsedArgs: Record<string, unknown>,
  options: {
    allowLegacySummaryAsFinal?: boolean
    source?: 'planning' | 'recovery'
  } = {}
): PlanResult | null {
  const {
    allowLegacySummaryAsFinal = true,
    source = 'planning'
  } = options

  const parsedType =
    typeof parsedArgs['type'] === 'string'
      ? parsedArgs['type'].trim().toLowerCase()
      : ''

  if (parsedType === 'final') {
    const answer =
      typeof parsedArgs['answer'] === 'string'
        ? parsedArgs['answer'].trim()
        : ''
    if (!answer) {
      return null
    }

    return {
      type: 'handoff',
      signal: {
        intent: parseFinalIntent(parsedArgs['intent']),
        draft: answer,
        source
      }
    }
  }

  if (parsedType === 'handoff') {
    const draft =
      typeof parsedArgs['draft'] === 'string'
        ? parsedArgs['draft'].trim()
        : ''
    if (!draft) {
      return null
    }

    return {
      type: 'handoff',
      signal: {
        intent: parseFinalIntent(parsedArgs['intent']),
        draft,
        source
      }
    }
  }

  if (parsedType === 'plan') {
    if (!Array.isArray(parsedArgs['steps'])) {
      return null
    }

    const steps = parseStepsFromArgs(
      parsedArgs['steps'] as Record<string, unknown>[]
    )
    if (steps.length === 0) {
      return null
    }

    const summary =
      typeof parsedArgs['summary'] === 'string'
        ? parsedArgs['summary'].trim()
        : ''
    return { type: 'plan', steps, summary }
  }

  // Backward compatibility for older payloads without explicit `type`.
  if (Array.isArray(parsedArgs['steps'])) {
    const steps = parseStepsFromArgs(
      parsedArgs['steps'] as Record<string, unknown>[]
    )
    if (steps.length > 0) {
      const summary =
        typeof parsedArgs['summary'] === 'string'
          ? parsedArgs['summary'].trim()
          : ''
      return { type: 'plan', steps, summary }
    }
  }

  if (allowLegacySummaryAsFinal) {
    const summary =
      typeof parsedArgs['summary'] === 'string'
        ? parsedArgs['summary'].trim()
        : ''
    if (summary) {
      return {
        type: 'handoff',
        signal: {
          intent: 'answer',
          draft: summary,
          source
        }
      }
    }
  }

  const answer =
    typeof parsedArgs['answer'] === 'string'
      ? parsedArgs['answer'].trim()
      : ''
  if (answer) {
    return {
      type: 'handoff',
      signal: {
        intent: parseFinalIntent(parsedArgs['intent']),
        draft: answer,
        source
      }
    }
  }

  return null
}

export function extractTaggedJson(input: string): string | null {
  const tagMatch = input.match(/\[(TOOL|TOOLKIT|FUNCTION|FINAL|PLAN|EXECUTE|REPLAN)\]/i)
  if (!tagMatch || tagMatch.index === undefined) {
    return null
  }

  const startIndex = tagMatch.index + tagMatch[0].length
  const rest = input.slice(startIndex).trim()
  return extractJsonSubstring(rest)
}

export function extractJsonSubstring(input: string): string | null {
  const firstBrace = input.indexOf('{')
  const firstBracket = input.indexOf('[')
  let startIndex = -1
  let endIndex = -1

  if (firstBrace !== -1 && firstBracket !== -1) {
    startIndex = Math.min(firstBrace, firstBracket)
  } else {
    startIndex = Math.max(firstBrace, firstBracket)
  }

  if (startIndex === -1) {
    return null
  }

  if (input[startIndex] === '{') {
    endIndex = input.lastIndexOf('}')
  } else {
    endIndex = input.lastIndexOf(']')
  }

  if (endIndex <= startIndex) {
    return null
  }

  return input.slice(startIndex, endIndex + 1)
}

export function extractFinalAnswerFromToolResult(toolExecutionResult: {
  status: string
  data?: {
    output?: Record<string, unknown>
  }
}): string | null {
  if (toolExecutionResult.status !== 'success') {
    return null
  }

  const output = toolExecutionResult.data?.output || {}
  const finalAnswer = output['final_answer']
  if (typeof finalAnswer === 'string' && finalAnswer.trim()) {
    return finalAnswer
  }
  const answer = output['answer']
  if (typeof answer === 'string' && answer.trim()) {
    return answer
  }
  return null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateToolInput(
  toolInput: string,
  parameters: Record<string, unknown> | null
): {
  isValid: boolean
  message?: string
  repairedToolInput?: string
  parsedValue?: Record<string, unknown>
} {
  if (!parameters) {
    return {
      isValid: false,
      message: 'No parameters schema found for this function.'
    }
  }

  let parsed: unknown = null
  let parsedFromRepair: { repaired: string, value: unknown } | null = null
  try {
    parsed = JSON.parse(toolInput)
  } catch {
    parsedFromRepair = tryRepairToolInput(toolInput)
    if (!parsedFromRepair) {
      return {
        isValid: false,
        message: 'tool_input must be valid JSON.'
      }
    }
    parsed = parsedFromRepair.value
  }

  const validateSchema = (
    schema: Record<string, unknown>,
    value: unknown
  ): boolean => {
    if (schema['oneOf'] && Array.isArray(schema['oneOf'])) {
      return schema['oneOf'].some((candidate) => {
        if (candidate && typeof candidate === 'object') {
          return validateSchema(candidate as Record<string, unknown>, value)
        }
        return false
      })
    }

    const schemaType = schema['type']
    if (schemaType === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false
      }

      const required = Array.isArray(schema['required'])
        ? (schema['required'] as string[])
        : []
      for (const key of required) {
        if (!(key in (value as Record<string, unknown>))) {
          return false
        }
      }

      const properties = schema['properties']
      if (properties && typeof properties === 'object') {
        for (const [key, propSchema] of Object.entries(properties)) {
          if (
            key in (value as Record<string, unknown>) &&
            propSchema &&
            typeof propSchema === 'object'
          ) {
            const propValue = (value as Record<string, unknown>)[key]
            if (
              !validateSchema(
                propSchema as Record<string, unknown>,
                propValue
              )
            ) {
              return false
            }
          }
        }
      }

      return true
    }

    if (schemaType === 'array') {
      if (!Array.isArray(value)) {
        return false
      }
      const items = schema['items']
      if (items && typeof items === 'object') {
        return value.every((item) =>
          validateSchema(items as Record<string, unknown>, item)
        )
      }
      return true
    }

    if (schemaType === 'string') {
      return typeof value === 'string'
    }
    if (schemaType === 'number') {
      return typeof value === 'number' && Number.isFinite(value)
    }
    if (schemaType === 'boolean') {
      return typeof value === 'boolean'
    }

    return true
  }

  const isValid = validateSchema(parameters, parsed)
  if (!isValid) {
    return {
      isValid: false,
      message: 'tool_input does not match the function parameters schema.'
    }
  }

  const result: {
    isValid: boolean
    repairedToolInput?: string
    parsedValue?: Record<string, unknown>
  } = {
    isValid: true
  }
  if (parsedFromRepair?.repaired) {
    result.repairedToolInput = parsedFromRepair.repaired
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    result.parsedValue = parsed as Record<string, unknown>
  }
  return result
}

export function tryRepairToolInput(
  toolInput: string
): { repaired: string, value: unknown } | null {
  const repaired = repairJsonStringLiterals(toolInput)
  if (repaired === toolInput) {
    return null
  }

  try {
    const value = JSON.parse(repaired)
    return { repaired, value }
  } catch {
    return null
  }
}

export function repairJsonStringLiterals(input: string): string {
  let inString = false
  let escaped = false
  let result = ''

  const isValidEscape = (char: string): boolean => {
    return (
      char === '"' ||
      char === '\\' ||
      char === '/' ||
      char === 'b' ||
      char === 'f' ||
      char === 'n' ||
      char === 'r' ||
      char === 't' ||
      char === 'u'
    )
  }

  const nextNonSpace = (value: string, start: number): string => {
    for (let i = start; i < value.length; i += 1) {
      const char = value[i]
      if (char && !/\s/.test(char)) {
        return char
      }
    }
    return ''
  }

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]

    if (!inString) {
      if (char === '"') {
        inString = true
      }
      result += char
      continue
    }

    if (escaped) {
      result += char
      escaped = false
      continue
    }

    if (char === '\\') {
      const nextChar = input[i + 1]
      if (nextChar && isValidEscape(nextChar)) {
        result += char
        escaped = true
        continue
      }
      result += '\\\\'
      continue
    }

    if (char === '"') {
      const nextChar = nextNonSpace(input, i + 1)
      const isTerminator =
        nextChar === '' ||
        nextChar === ',' ||
        nextChar === '}' ||
        nextChar === ']' ||
        nextChar === ':'
      if (isTerminator) {
        inString = false
        result += char
        continue
      }
      result += '\\"'
      continue
    }

    result += char
  }

  return result
}
