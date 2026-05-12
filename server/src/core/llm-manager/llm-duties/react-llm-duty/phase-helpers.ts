import { LogHelper } from '@/helpers/log-helper'
import { TOOLKIT_REGISTRY } from '@/core'
import {
  NODE_RUNTIME_BIN_PATH,
  PNPM_RUNTIME_BIN_PATH,
  PYTHON_RUNTIME_BIN_PATH,
  UV_RUNTIME_BIN_PATH
} from '@/constants'

import { CHARS_PER_TOKEN, DUTY_NAME } from './constants'
import type {
  AgentSkillContext,
  ExecutionRecord,
  LLMCaller,
  PlanResult
} from './types'
import { parseToolCallArguments } from './utils'

export interface DuplicateInputMatch {
  stepNumber: number
  stepLabel: string | null
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
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

export function normalizeToolInputForComparison(toolInput: string): string {
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

export function extractFailureMessageFromObservation(observation: string): string {
  const parsed = parseToolCallArguments(observation)
  if (!parsed) {
    return observation
  }

  const message =
    typeof parsed['message'] === 'string' ? parsed['message'].trim() : ''
  if (message) {
    return message
  }

  const toolOutputFailure = asRecord(parsed['tool_output_failure'])
  const failureError =
    toolOutputFailure && typeof toolOutputFailure['error'] === 'string'
      ? (toolOutputFailure['error'] as string).trim()
      : ''
  if (failureError) {
    return failureError
  }

  return observation
}

function getExecutionRequestedToolInput(execution: ExecutionRecord): string | null {
  if (execution.requestedToolInput && execution.requestedToolInput.trim()) {
    return execution.requestedToolInput
  }

  return extractRequestedToolInputFromObservation(execution.observation)
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

    if (normalizedRequested === normalizedCandidate) {
      return {
        stepNumber: index + 1,
        stepLabel: execution.stepLabel ?? null
      }
    }
  }

  return null
}

export function buildPreviouslyUsedInputsSection(
  history: ExecutionRecord[],
  functionName: string
): string {
  const previousInputs = history
    .map((execution, index) => {
      if (execution.function !== functionName) {
        return null
      }

      const stepNumber = index + 1
      const requestedToolInput = getExecutionRequestedToolInput(execution)
      if (!requestedToolInput) {
        return null
      }

      const labelPart = execution.stepLabel
        ? ` | label="${execution.stepLabel}"`
        : ''
      return `- Step ${stepNumber}${labelPart}: ${requestedToolInput}`
    })
    .filter((line): line is string => Boolean(line))

  if (previousInputs.length === 0) {
    return ''
  }

  return `\nPreviously executed inputs for this function in this run:\n${previousInputs.join('\n')}\nDo not reuse the exact same tool_input unless the current step explicitly asks to repeat it.`
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

      const clipped =
        normalized.length > 180
          ? `${normalized.slice(0, 177).trimEnd()}...`
          : normalized

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

export function buildContextManifestSection(manifest: string): string {
  const normalized = manifest.trim()
  if (!normalized) {
    return 'Context Files Available: none'
  }

  return `Context Files Available:\n${normalized}`
}

export function buildSelfModelSection(snapshot: string): string {
  const normalized = snapshot.trim()
  if (!normalized) {
    return 'Leon Self-Model Snapshot: none'
  }

  return normalized
}

export function buildActiveAgentSkillSection(
  agentSkillContext: AgentSkillContext | null | undefined
): string {
  if (!agentSkillContext) {
    return ''
  }

  return [
    '<active_agent_skill>',
    `id: ${agentSkillContext.id}`,
    `name: ${agentSkillContext.name}`,
    `description: ${agentSkillContext.description}`,
    `root_path: ${agentSkillContext.rootPath}`,
    `skill_path: ${agentSkillContext.skillPath}`,
    '',
    '<leon_agent_skill_runtime>',
    `node: ${NODE_RUNTIME_BIN_PATH}`,
    `python: ${PYTHON_RUNTIME_BIN_PATH}`,
    `pnpm: ${PNPM_RUNTIME_BIN_PATH}`,
    `uv: ${UV_RUNTIME_BIN_PATH}`,
    'When running local scripts for this active agent skill, prefer these managed binaries over bare node, python, pnpm, or uv commands.',
    '</leon_agent_skill_runtime>',
    '',
    agentSkillContext.instructions,
    '</active_agent_skill>',
    '',
    '<active_agent_skill_policy>',
    'This Agent Skill is the selected execution scope for the current step. Follow its SKILL.md instructions for this step.',
    'When the skill provides scripts or other resources that can perform the needed work, use those resources before any generic overlapping tool.',
    'For script-backed Agent Skills, execute the relevant script through operating_system_control.bash.executeBashCommand from the skill root path.',
    'Do not replace the selected Agent Skill with generic web, search, deep-research, or ad hoc scraping tools unless the skill script/resource was attempted and cannot satisfy the step.',
    'If recovery is needed, recover by adjusting the selected Agent Skill script/resource usage first.',
    '</active_agent_skill_policy>'
  ].join('\n')
}

export function buildAgentSkillDiscoverySection(caller: LLMCaller): string {
  return [
    '<available_agent_skills>',
    caller.agentSkillCatalog,
    '</available_agent_skills>'
  ].join('\n')
}

export function stripInlineToolMarkup(text: string): string {
  if (!text) {
    return ''
  }

  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function=[^>]+>/gi, '')
    .replace(/<\/function>/gi, '')
    .replace(/<parameter=[^>]+>[\s\S]*?<\/parameter>/gi, '')
    .trim()
}

export function shouldTreatPlanningTextAsFinalAnswer(text: string): boolean {
  return extractPlanningMarkedFinalAnswer(text) !== null
}

export function extractPlanningMarkedFinalAnswer(text: string): string | null {
  const sanitized = stripInlineToolMarkup(text)
  if (!sanitized) {
    return null
  }

  const match = sanitized.match(/^FINAL_ANSWER:\s*(.+)$/is)
  if (!match) {
    return null
  }

  const answer = match[1]?.trim() || ''
  return answer || null
}

export function extractPlanningTextHandoffDraft(text: string): string | null {
  const markedAnswer = extractPlanningMarkedFinalAnswer(text)
  if (markedAnswer) {
    return markedAnswer
  }

  if (!shouldTreatPlanningTextAsFinalAnswer(text)) {
    return null
  }

  const sanitized = stripInlineToolMarkup(text)
  return sanitized || text.trim() || null
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeStepLabelFromFunction(functionName: string): string {
  const lastPart = functionName.split('.').pop() || functionName
  const readable = humanizeIdentifier(lastPart)
  if (!readable) {
    return 'Run tool step'
  }

  return readable.charAt(0).toUpperCase() + readable.slice(1)
}
  
export function buildStepLabelFromFunction(functionName: string): string {
  return normalizeStepLabelFromFunction(functionName)
}

function commandTokenFromArgs(rawArguments: string): string {
  const parsedArgs = parseToolCallArguments(rawArguments)
  if (!parsedArgs) {
    return ''
  }

  const rawCommand =
    typeof parsedArgs['command'] === 'string'
      ? (parsedArgs['command'] as string).trim()
      : ''
  if (!rawCommand) {
    return ''
  }

  const firstToken = rawCommand.split(/\s+/)[0] || ''
  if (!firstToken) {
    return ''
  }

  const basename = firstToken.includes('/')
    ? firstToken.split('/').pop() || ''
    : firstToken
  return basename.replace(/[^a-zA-Z0-9._-]/g, '')
}

function buildRecoveredStepLabel(
  functionName: string,
  rawArguments: string
): string {
  const commandToken = commandTokenFromArgs(rawArguments)
  if (commandToken) {
    return `Run ${commandToken} command`
  }

  return buildStepLabelFromFunction(functionName)
}

function resolveFunctionNameForPlan(functionName: string): string | null {
  const trimmed = functionName.trim()
  if (!trimmed) {
    return null
  }

  const parts = trimmed.split('.')
  if (parts.length === 3) {
    const [toolkitId, toolId, fnName] = parts
    if (!toolkitId || !toolId || !fnName) {
      return null
    }

    const functions = TOOLKIT_REGISTRY.getToolFunctions(toolkitId, toolId)
    if (functions && fnName in functions) {
      return trimmed
    }

    return null
  }

  if (parts.length === 2) {
    const resolvedTool = TOOLKIT_REGISTRY.resolveToolById(trimmed)
    return resolvedTool ? trimmed : null
  }

  if (parts.length !== 1) {
    return null
  }

  const fnName = parts[0]
  if (!fnName) {
    return null
  }

  const matches: string[] = []
  const tools = TOOLKIT_REGISTRY.getFlattenedTools()
  for (const tool of tools) {
    const functions = TOOLKIT_REGISTRY.getToolFunctions(tool.toolkitId, tool.toolId)
    if (!functions || !(fnName in functions)) {
      continue
    }

    matches.push(`${tool.toolkitId}.${tool.toolId}.${fnName}`)
    if (matches.length > 1) {
      return null
    }
  }

  return matches[0] || null
}

export function createPlanFromUnexpectedToolCall(
  unexpectedToolCall: { functionName: string, arguments: string },
  textFallback: string
): PlanResult | null {
  const resolvedFunction = resolveFunctionNameForPlan(
    unexpectedToolCall.functionName
  )
  if (!resolvedFunction) {
    return null
  }

  const sanitizedSummary = stripInlineToolMarkup(textFallback).replace(/\s+/g, ' ').trim()
  const label = buildRecoveredStepLabel(
    resolvedFunction,
    unexpectedToolCall.arguments
  )
  const summary =
    sanitizedSummary ||
    `Working on ${label.charAt(0).toLowerCase()}${label.slice(1)}...`

  return {
    type: 'plan',
    summary,
    steps: [
      {
        function: resolvedFunction,
        label
      }
    ]
  }
}
