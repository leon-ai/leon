import { TOOLKIT_REGISTRY } from '@/core'
import { LogHelper } from '@/helpers/log-helper'

import { CHARS_PER_TOKEN, DUTY_NAME } from './constants'
import type {
  ExecutionRecord,
  LLMCaller
} from './types'
import { parseToolCallArguments } from './utils'

const TOOLKIT_CONTEXT_SUMMARY_MAX_CHARS = 180
const ARTIFACT_PATH_INPUT_FIELD = 'outputLogPath'
const ARTIFACT_OPTIONS_INPUT_FIELD = 'options'
const ARTIFACT_OFFSET_INPUT_FIELD = 'offsetChars'
const ARTIFACT_MAX_CHARS_INPUT_FIELD = 'maxChars'

interface DuplicateInputMatch {
  stepNumber: number
  stepLabel: string | null
}

interface ArtifactReadRange {
  path: string
  start: number
  end: number
}

function normalizeStepLabel(label: string | null | undefined): string {
  if (!label) {
    return ''
  }

  return label.trim().toLowerCase().replace(/\s+/g, ' ')
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `"${key}":${stableSerialize(val)}`)
    return `{${entries.join(',')}}`
  }

  return JSON.stringify(value)
}

function normalizeToolInputForComparison(toolInput: string): string {
  const trimmed = toolInput.trim()
  if (!trimmed) {
    return ''
  }

  const parsed = parseToolCallArguments(trimmed)
  if (parsed) {
    return stableSerialize(parsed)
  }

  return trimmed.replace(/\s+/g, ' ')
}

function extractRequestedToolInputFromObservation(
  observation: string
): string | null {
  const parsed = parseToolCallArguments(observation)
  if (!parsed) {
    return null
  }

  const requestedInput = parsed['requested_input']
  if (typeof requestedInput === 'string' && requestedInput.trim()) {
    return requestedInput
  }

  const parsedInput = parsed['requested_parsed_input']
  if (parsedInput && typeof parsedInput === 'object') {
    try {
      return JSON.stringify(parsedInput)
    } catch {
      return String(parsedInput)
    }
  }

  return null
}

function getExecutionRequestedToolInput(execution: ExecutionRecord): string | null {
  if (execution.requestedToolInput && execution.requestedToolInput.trim()) {
    return execution.requestedToolInput
  }

  return extractRequestedToolInputFromObservation(execution.observation)
}

function readArtifactRange(toolInput: string): ArtifactReadRange | null {
  const parsed = parseToolCallArguments(toolInput)
  const path = parsed?.[ARTIFACT_PATH_INPUT_FIELD]
  if (typeof path !== 'string' || !path.trim()) {
    return null
  }

  const optionsValue = parsed?.[ARTIFACT_OPTIONS_INPUT_FIELD]
  const options =
    optionsValue &&
    typeof optionsValue === 'object' &&
    !Array.isArray(optionsValue)
      ? (optionsValue as Record<string, unknown>)
      : {}
  const offset = options[ARTIFACT_OFFSET_INPUT_FIELD]
  const maxChars = options[ARTIFACT_MAX_CHARS_INPUT_FIELD]
  const start = typeof offset === 'number' && offset >= 0 ? offset : 0
  const length =
    typeof maxChars === 'number' && maxChars > 0
      ? maxChars
      : Number.POSITIVE_INFINITY

  return {
    path: path.trim(),
    start,
    end: start + length
  }
}

function artifactReadRangesOverlap(
  previousInput: string,
  candidateInput: string
): boolean {
  const previousRange = readArtifactRange(previousInput)
  const candidateRange = readArtifactRange(candidateInput)
  return Boolean(
    previousRange &&
      candidateRange &&
      previousRange.path === candidateRange.path &&
      previousRange.start < candidateRange.end &&
      candidateRange.start < previousRange.end
  )
}

export function findDuplicateToolInputMatch(
  history: ExecutionRecord[],
  functionName: string,
  currentStepLabel: string,
  candidateToolInput: string
): DuplicateInputMatch | null {
  const normalizedCandidate = normalizeToolInputForComparison(candidateToolInput)
  if (!normalizedCandidate) {
    return null
  }

  const normalizedCurrentStepLabel = normalizeStepLabel(currentStepLabel)

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const execution = history[index]
    if (!execution || execution.function !== functionName) {
      continue
    }

    const executionStepLabel = normalizeStepLabel(execution.stepLabel)
    if (
      normalizedCurrentStepLabel &&
      executionStepLabel &&
      executionStepLabel !== normalizedCurrentStepLabel
    ) {
      continue
    }

    const requestedInput = getExecutionRequestedToolInput(execution)
    if (!requestedInput) {
      continue
    }

    const normalizedRequested = normalizeToolInputForComparison(requestedInput)
    if (!normalizedRequested) {
      continue
    }

    if (
      normalizedRequested === normalizedCandidate ||
      artifactReadRangesOverlap(requestedInput, candidateToolInput)
    ) {
      return {
        stepNumber: index + 1,
        stepLabel: execution.stepLabel ?? null
      }
    }
  }

  return null
}

function extractContextSummary(content: string, maxChars: number): string | null {
  const firstSummaryLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('>'))
  const fallbackLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  const summarySource = firstSummaryLine || fallbackLine || ''
  if (!summarySource) {
    return null
  }

  const normalized = summarySource
    .replace(/^>\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) {
    return null
  }

  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars - 3).trimEnd()}...`
    : normalized
}

export function buildToolkitContextSection(
  caller: LLMCaller,
  toolkitId: string
): string {
  const injectedContextFiles = [
    ...new Set(TOOLKIT_REGISTRY.getToolkitContextFiles(toolkitId))
  ]
  const summaryLines = injectedContextFiles
    .map((filename) => {
      const content = caller.getContextFileContent(filename)?.trim() || ''
      if (!content) {
        return null
      }

      const clipped = extractContextSummary(
        content,
        TOOLKIT_CONTEXT_SUMMARY_MAX_CHARS
      )
      if (!clipped) {
        return null
      }

      return `- ${filename}: ${clipped}`
    })
    .filter((line): line is string => Boolean(line))

  const toolkitContext = summaryLines.join('\n')
  const contextCharCount = toolkitContext.length
  const estimatedContextTokens = Math.ceil(
    contextCharCount / CHARS_PER_TOKEN
  )

  LogHelper.title(`${DUTY_NAME} / execution`)
  LogHelper.debug(
    `Toolkit context injection [${toolkitId}] files=${injectedContextFiles.length > 0 ? injectedContextFiles.join(', ') : 'none'} | chars=${contextCharCount} | est_tokens=${estimatedContextTokens}`
  )

  if (summaryLines.length === 0) {
    return 'Toolkit Context: none'
  }

  return `Toolkit Context Summary:\n${toolkitContext}`
}
