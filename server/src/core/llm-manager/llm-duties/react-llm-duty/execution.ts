import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { LogHelper } from '@/helpers/log-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import {
  TOOLKIT_REGISTRY,
  TOOL_EXECUTOR,
  SOCKET_SERVER,
  BRAIN
} from '@/core'
import type { OpenAITool } from '@/core/llm-manager/types'

import {
  RESOLVE_FUNCTION_SYSTEM_PROMPT,
  EXECUTE_SYSTEM_PROMPT,
  MAX_RETRIES_PER_FUNCTION,
  MAX_TOOL_FAILURE_RETRIES,
  DUTY_NAME
} from './constants'
import type {
  PlanStep,
  ExecutionRecord,
  Catalog,
  ExecutionStepResult,
  ToolExecutionResult,
  LLMCaller,
  FunctionConfig,
  PromptLogSection,
  LLMCallOptions,
  FinalPhaseIntent,
  FinalResponseSignal,
  AgentSkillContext
} from './types'
import {
  isToolLevel,
  formatExecutionHistory,
  parseOutput,
  parseStepsFromArgs,
  validateToolInput,
  extractFinalAnswerFromToolResult,
  formatFilePath
} from './utils'
import {
  asRecord,
  buildStepLabelFromFunction,
  normalizeToolInputForComparison,
  extractFailureMessageFromObservation,
  findDuplicateToolInputMatch,
  buildPreviouslyUsedInputsSection,
  buildToolkitContextSection,
  buildContextManifestSection,
  buildSelfModelSection,
  buildActiveAgentSkillSection
} from './phase-helpers'
import {
  buildPhaseSystemPrompt
} from './phase-policy'

// Tool argument generation may still need execution reasoning to replan when
// prerequisites are missing. Only disable provider streaming here, so timeouts
// still protect tool calls if a stream opens but stalls before a final result.
const TOOL_ARGUMENT_LLM_OPTIONS = {
  phase: 'execution',
  streamToProvider: false
} satisfies LLMCallOptions

const TOOL_PREPARATION_STARTED_REPORT_KEYS = new Set([
  'bridges.tools.creating_bins_directory',
  'bridges.tools.binary_not_found',
  'bridges.tools.downloading_from_url',
  'bridges.tools.download_progress',
  'bridges.tools.download_progress_with_details',
  'bridges.tools.extracting_archive',
  'bridges.tools.making_executable',
  'bridges.tools.removing_quarantine',
  'bridges.tools.creating_resource_directory',
  'bridges.tools.downloading_resource',
  'bridges.tools.downloading_resource_file'
])
const TOOL_PREPARATION_READY_REPORT_KEYS = new Set([
  'bridges.tools.binary_ready',
  'bridges.tools.resource_downloaded'
])
const TOOL_PREPARATION_FAILED_REPORT_KEYS = new Set([
  'bridges.tools.no_binary_url',
  'bridges.tools.no_resource_urls',
  'bridges.tools.download_failed',
  'bridges.tools.download_url_failed',
  'bridges.tools.resource_file_download_failed'
])

async function buildExecutionMemorySection(
  _caller: LLMCaller,
  toolkitId: string
): Promise<string> {
  LogHelper.title(`${DUTY_NAME} / execution`)
  LogHelper.debug(
    `Execution memory injection disabled [${toolkitId}] (use structured_knowledge.memory.read when memory is needed)`
  )
  return 'Execution Memory: none'
}

function buildExecutionPromptSections(params: {
  prompt: string
  systemPrompt: string
  baseSystemPromptContent?: string
  promptSource: string
  systemPromptSource: string
  schema?: Record<string, unknown>
  tools?: OpenAITool[]
}): PromptLogSection[] {
  const sections: PromptLogSection[] = [
    {
      name: 'SYSTEM_PROMPT_FULL',
      source: 'server/src/core/llm-manager/persona.ts',
      content: params.systemPrompt
    },
    {
      name: 'EXECUTION_INPUT',
      source: params.promptSource,
      content: params.prompt
    }
  ]

  if (params.baseSystemPromptContent) {
    sections.splice(1, 0, {
      name: 'BASE_SYSTEM_PROMPT',
      source: params.systemPromptSource,
      content: params.baseSystemPromptContent
    })
  }

  if (params.schema) {
    sections.push({
      name: 'EXECUTION_SCHEMA',
      source: params.promptSource,
      content: JSON.stringify(params.schema)
    })
  }

  if (params.tools) {
    sections.push({
      name: 'TOOLS_SCHEMA',
      source: params.promptSource,
      content: JSON.stringify(params.tools)
    })
  }

  return sections
}

function parseExecutionHandoffIntent(
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

function createExecutionHandoff(
  draft: string,
  intent: FinalPhaseIntent = 'answer',
  source: FinalResponseSignal['source'] = 'execution'
): { type: 'handoff', signal: FinalResponseSignal } {
  return {
    type: 'handoff',
    signal: {
      intent,
      draft,
      source
    }
  }
}

function shouldInjectContextManifestForExecution(
  toolkitId: string,
  toolId: string
): boolean {
  return toolkitId === 'structured_knowledge' && toolId === 'context'
}

function resolveUniqueFunctionByLeafName(
  functionName: string
): string | null {
  const normalizedFunctionName = functionName.trim()
  if (!normalizedFunctionName) {
    return null
  }

  const matches: string[] = []
  for (const tool of TOOLKIT_REGISTRY.getFlattenedTools()) {
    const functions = TOOLKIT_REGISTRY.getToolFunctions(
      tool.toolkitId,
      tool.toolId
    )

    if (functions?.[normalizedFunctionName]) {
      matches.push(
        `${tool.toolkitId}.${tool.toolId}.${normalizedFunctionName}`
      )
    }
  }

  return matches.length === 1 ? matches[0]! : null
}

function resolvePlannedFunctionReference(qualifiedName: string): string | null {
  const normalizedQualifiedName = qualifiedName.trim()
  if (!normalizedQualifiedName) {
    return null
  }

  const parts = normalizedQualifiedName.split('.').filter(Boolean)
  if (parts.length >= 3) {
    const toolkitId = parts[0] || ''
    const toolId = parts[1] || ''
    const functionName = parts.slice(2).join('.') || ''
    const functions = TOOLKIT_REGISTRY.getToolFunctions(toolkitId, toolId)

    if (functions?.[functionName]) {
      return normalizedQualifiedName
    }
  }

  if (parts.length <= 2) {
    const toolkitId = parts.length === 2 ? parts[0] : undefined
    const toolId = parts.length === 2 ? parts[1] : parts[0]
    if (toolId && TOOLKIT_REGISTRY.resolveToolById(toolId, toolkitId)) {
      return normalizedQualifiedName
    }
  }

  const leafName = parts[parts.length - 1] || ''
  return resolveUniqueFunctionByLeafName(leafName)
}

function buildExecutionContextManifestSection(
  caller: LLMCaller,
  toolkitId: string,
  toolId: string
): string {
  if (!shouldInjectContextManifestForExecution(toolkitId, toolId)) {
    return ''
  }

  return buildContextManifestSection(caller.getContextManifest())
}

function buildExecutionReplanFallbackLabel(functionName: string): string {
  return buildStepLabelFromFunction(functionName)
}

function stringifyToolPanelValue(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return '(empty)'
    }

    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2)
    } catch {
      return trimmed
    }
  }

  if (typeof value === 'undefined') {
    return '(empty)'
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function createToolGroupId(
  toolkitId: string,
  toolId: string,
  functionName: string
): string {
  return `react_${toolkitId}_${toolId}_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function getToolDisplayContext(
  toolkitId: string,
  toolId: string,
  functionName: string
): {
  toolkitName: string
  toolName: string
  toolkitIconName?: string
  toolIconName?: string
  key: string
} {
  const resolvedTool = TOOLKIT_REGISTRY.resolveToolById(toolId, toolkitId)

  return {
    toolkitName: resolvedTool?.toolkitName || toolkitId,
    toolName: resolvedTool?.toolName || toolId,
    ...(resolvedTool?.toolkitIconName
      ? { toolkitIconName: resolvedTool.toolkitIconName }
      : {}),
    ...(resolvedTool?.toolIconName
      ? { toolIconName: resolvedTool.toolIconName }
      : {}),
    key: `${toolkitId}.${toolId}.${functionName}`
  }
}

function emitAgentSkillActivityToWebApp(
  agentSkillContext: AgentSkillContext,
  stepLabel: string
): void {
  const skillGroupId =
    `react_agent_skill_${agentSkillContext.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  SOCKET_SERVER.emitAnswerToChatClients({
    answer: `Using Agent Skill: ${agentSkillContext.name}\nStep: ${stepLabel}\nFollowing: ${agentSkillContext.skillPath}`,
    isToolOutput: true,
    toolDisplayMode: 'activity_card',
    activityType: 'agent_skill',
    status: 'selected',
    toolGroupId: skillGroupId,
    key: `agent_skill.${agentSkillContext.id}.using`,
    agentSkill: {
      id: agentSkillContext.id,
      name: agentSkillContext.name,
      description: agentSkillContext.description,
      rootPath: agentSkillContext.rootPath,
      skillPath: agentSkillContext.skillPath,
      stepLabel
    }
  })
}

function emitToolExecutionInputToWebApp(params: {
  toolkitId: string
  toolId: string
  functionName: string
  toolInput: string
  toolGroupId: string
  stepLabel?: string
}): void {
  const displayContext = getToolDisplayContext(
    params.toolkitId,
    params.toolId,
    params.functionName
  )
  const prefixLines = params.stepLabel
    ? [`Step: ${params.stepLabel}`, '']
    : []
  const inputMessage = [
    ...prefixLines,
    'Input:',
    stringifyToolPanelValue(params.toolInput)
  ].join('\n')

  SOCKET_SERVER.emitAnswerToChatClients({
    answer: inputMessage,
    isToolOutput: true,
    toolDisplayMode: 'activity_card',
    toolPhase: 'input',
    ...displayContext,
    toolGroupId: params.toolGroupId,
    functionName: params.functionName,
    toolInput: params.toolInput,
    ...(params.stepLabel ? { stepLabel: params.stepLabel } : {})
  })
}

function emitToolPreparationProgressToWebApp(params: {
  toolkitId: string
  toolId: string
  functionName: string
  toolGroupId: string
  message: string
  stepLabel?: string
}): void {
  const message = params.message.trim()
  if (!message) {
    return
  }

  SOCKET_SERVER.emitAnswerToChatClients({
    answer: message,
    isToolOutput: true,
    toolDisplayMode: 'activity_card',
    toolPhase: 'preparation',
    ...getToolDisplayContext(
      params.toolkitId,
      params.toolId,
      params.functionName
    ),
    toolGroupId: params.toolGroupId,
    functionName: params.functionName,
    status: 'running',
    message,
    ...(params.stepLabel ? { stepLabel: params.stepLabel } : {})
  })
}

function emitToolPreparationOwnerMessage(
  key: string,
  toolName: string
): void {
  const message = BRAIN.wernicke(key, '', {
    '{{ tool_name }}': toolName
  })
  if (!message) {
    return
  }

  void BRAIN.talk(message).catch((error) => {
    LogHelper.title(`${DUTY_NAME} / execution`)
    LogHelper.warning(
      `Failed to emit tool preparation owner message: ${String(error)}`
    )
  })
}

function emitToolExecutionOutputToWebApp(params: {
  toolkitId: string
  toolId: string
  functionName: string
  toolGroupId: string
  output: Record<string, unknown>
  status: string
  message: string
  stepLabel?: string
}): void {
  const outputPayload = {
    status: params.status,
    message: params.message,
    output: params.output
  }
  const outputMessage = [
    `Output (${params.status}):`,
    stringifyToolPanelValue(outputPayload)
  ].join('\n')

  SOCKET_SERVER.emitAnswerToChatClients({
    answer: outputMessage,
    isToolOutput: true,
    toolDisplayMode: 'activity_card',
    toolPhase: 'output',
    ...getToolDisplayContext(
      params.toolkitId,
      params.toolId,
      params.functionName
    ),
    toolGroupId: params.toolGroupId,
    functionName: params.functionName,
    status: params.status,
    message: params.message,
    output: params.output,
    ...(params.stepLabel ? { stepLabel: params.stepLabel } : {})
  })
}

function extractExecutionReplanSteps(
  parsed: Record<string, unknown>
): PlanStep[] {
  if (Array.isArray(parsed['steps'])) {
    return (parsed['steps'] as Record<string, unknown>[])
      .filter(
        (step) =>
          typeof step['function'] === 'string' &&
          (step['function'] as string).trim()
      )
      .map((step) => {
        const functionName = (step['function'] as string).trim()
        const label =
          typeof step['label'] === 'string' && (step['label'] as string).trim()
            ? (step['label'] as string).trim()
            : buildExecutionReplanFallbackLabel(functionName)

        return {
          function: functionName,
          label,
          ...(
            typeof step['agent_skill_id'] === 'string' &&
            (step['agent_skill_id'] as string).trim()
              ? {
                  agentSkillId: (step['agent_skill_id'] as string).trim()
                }
              : {}
          )
        }
      })
  }

  if (Array.isArray(parsed['functions'])) {
    return parseStepsFromArgs(
      (parsed['functions'] as string[]).map((functionName) => ({
        function: functionName,
        label: buildExecutionReplanFallbackLabel(functionName)
      }))
    )
  }

  return []
}

export async function runExecutionSelfObservationPhase(
  caller: LLMCaller,
  executionHistory: ExecutionRecord[]
): Promise<
  | { type: 'handoff', signal: FinalResponseSignal }
  | { type: 'replan', reason: string, steps: PlanStep[] }
  | null
> {
  const historySection = formatExecutionHistory(executionHistory)
  const baseSystemPrompt = `You are evaluating whether execution should continue after the current plan finished.

<task>
Use only the user request and collected observations to decide whether the request is complete or whether more tool steps are still needed.
</task>

<decision_contract>
- Return ONLY one of:
  - {"type":"handoff","intent":"answer","draft":"..."} when the request is fully completed.
  - {"type":"replan","steps":[{"function":"toolkit_id.tool_id.function_name","label":"Short verb-first label"}],"reason":"..."} when more tool steps are still needed.
- Treat the task as complete only when every requested deliverable is already satisfied or explicitly blocked by the observations.
- If any requested artifact, transformation, verification, write step, or follow-up action is still missing, choose "replan".
- Do not add fallback/alternative steps after the primary path already satisfied the deliverable.
- If a read, probe, or discovery step reveals another instruction or subtask to carry out, the task is still incomplete until that revealed instruction is executed or explicitly blocked.
- Reading, quoting, or summarizing an instruction does not count as completing the instruction itself.
- Base your decision strictly on observations, not assumptions.
- If unsure, choose "replan" and provide the minimum next functions needed.
- Treat inferred runtime signals (timezone, locale, VPN/proxy, IP/location hints) as environment hints, not confirmed owner facts.
- If the remaining gap is a missing owner fact or a missing dedicated retrieval step before a write/report step, choose "replan" instead of assuming.
- If the current best answer would still rely on weak hints or unresolved uncertainty that context or memory could reduce, choose "replan" and add grounding steps instead of handing off an answer.
- If your best draft would mention a next step, remaining work, or that something still needs to be done, choose "replan" instead of "handoff".
- For "replan", "reason" must be a short progress update in present progressive form, written in neutral or first-person phrasing, and end with "...". Example: "Checking additional context files...".
- For "replan", every step label must be a short user-facing action, start with a verb, and stay under 8 words.
- "draft" should be a concise handoff payload for the final answer phase.
</decision_contract>`
  const systemPrompt = buildPhaseSystemPrompt(
    baseSystemPrompt,
    'execution'
  )
  const selfModelSection = buildSelfModelSection(caller.getSelfModelSnapshot())
  const contextManifestSection = buildContextManifestSection(
    caller.getContextManifest()
  )
  const prompt = `<self_model>\n${selfModelSection}\n</self_model>\n\n<context_manifest>\n${contextManifestSection}\n</context_manifest>\n\n<execution_history>\n${historySection}\n</execution_history>\n\n<user_request>\n${caller.input}\n</user_request>\n\n<current_plan_status>\nNo pending steps remain.\n</current_plan_status>\n\n<task>\nDecide whether to finish now or continue with additional steps.\n</task>`

  const schema = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['handoff', 'replan'] },
      draft: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      intent: {
        anyOf: [
          {
            type: 'string',
            enum: ['answer', 'clarification', 'cancelled', 'blocked', 'error']
          },
          { type: 'null' }
        ]
      },
      functions: {
        anyOf: [
          {
            type: 'array',
            items: { type: 'string' }
          },
          { type: 'null' }
        ]
      },
      steps: {
        anyOf: [
          {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                function: { type: 'string' },
                label: { type: 'string' }
              },
              required: ['function', 'label'],
              additionalProperties: false
            }
          },
          { type: 'null' }
        ]
      },
      reason: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      }
    },
    required: ['type', 'draft', 'intent', 'functions', 'steps', 'reason'],
    additionalProperties: false
  }

  const completion = await caller.callLLM(
    prompt,
    systemPrompt,
    schema,
    caller.history,
    buildExecutionPromptSections({
      prompt,
      systemPrompt,
      baseSystemPromptContent: baseSystemPrompt,
      promptSource:
        'server/src/core/llm-manager/llm-duties/react-llm-duty/execution.ts',
      systemPromptSource:
        'server/src/core/llm-manager/llm-duties/react-llm-duty/execution.ts',
      schema
    }),
    {
      phase: 'execution',
      reasoningMode: 'off'
    }
  )

  if (!completion) {
    const providerError = caller.consumeProviderErrorMessage()
    if (providerError) {
      return createExecutionHandoff(providerError, 'error', 'self_observation')
    }
    return null
  }

  const parsed = parseOutput(completion.output)
  if (!parsed) {
    return null
  }

  if (parsed['type'] === 'handoff' && typeof parsed['draft'] === 'string') {
    const draft = parsed['draft'].trim()
    if (draft) {
      return createExecutionHandoff(
        draft,
        parseExecutionHandoffIntent(parsed['intent']),
        'self_observation'
      )
    }
  }

  if (parsed['type'] === 'replan') {
    return {
      type: 'replan',
      reason: (parsed['reason'] as string) || 'More steps are needed',
      steps: extractExecutionReplanSteps(parsed)
    }
  }

  return null
}

async function resolveStepAgentSkillContext(
  caller: LLMCaller,
  step: PlanStep
): Promise<{
  context: AgentSkillContext | null
  error?: string
}> {
  if (!step.agentSkillId) {
    return {
      context: caller.agentSkillContext || null
    }
  }

  const agentSkillContext = await caller.getAgentSkillContext(
    step.agentSkillId
  )

  if (!agentSkillContext) {
    return {
      context: null,
      error: `Agent Skill "${step.agentSkillId}" is not installed or enabled.`
    }
  }

  LogHelper.title(`${DUTY_NAME} / execution`)
  LogHelper.debug(
    `Loaded Agent Skill "${step.agentSkillId}" for step "${step.label}".`
  )
  emitAgentSkillActivityToWebApp(agentSkillContext, step.label)

  return {
    context: agentSkillContext
  }
}

export async function runExecutionStep(
  caller: LLMCaller,
  step: PlanStep,
  executionHistory: ExecutionRecord[],
  catalog: Catalog
): Promise<ExecutionStepResult> {
  const resolvedQualifiedName = resolvePlannedFunctionReference(step.function)

  if (!resolvedQualifiedName) {
    return {
      type: 'executed',
      execution: {
        function: step.function,
        status: 'error',
        observation: `Invalid function reference "${step.function}". Use a function from the available catalog.`
      }
    }
  }

  if (resolvedQualifiedName !== step.function) {
    LogHelper.title(`${DUTY_NAME} / execution`)
    LogHelper.debug(
      `Normalized planned function "${step.function}" -> "${resolvedQualifiedName}"`
    )
  }

  const qualifiedName = resolvedQualifiedName
  const parts = qualifiedName.split('.')
  const agentSkillResolution = await resolveStepAgentSkillContext(caller, step)

  if (agentSkillResolution.error) {
    return {
      type: 'executed',
      execution: {
        function: qualifiedName,
        status: 'error',
        observation: agentSkillResolution.error
      }
    }
  }

  const agentSkillContext = agentSkillResolution.context

  // If the plan only has tool-level references (from tool-level catalog),
  // we need an extra resolution step to pick the right function.
  if (isToolLevel(qualifiedName) || catalog.mode === 'tool') {
    return runToolLevelExecution(
      caller,
      qualifiedName,
      step.label,
      parts,
      executionHistory,
      catalog,
      agentSkillContext
    )
  }

  // Function-level: we have toolkit.tool.function
  const toolkitId = parts[0] || ''
  const toolId = parts[1] || ''
  const functionName = parts.slice(2).join('.') || ''

  if (!toolkitId || !toolId || !functionName) {
    return {
      type: 'executed',
      execution: {
        function: qualifiedName,
        status: 'error',
        observation: `Invalid function reference "${qualifiedName}". Expected format: toolkit_id.tool_id.function_name.`
      }
    }
  }

  // Get function schema for this specific function
  const toolFunctions = TOOLKIT_REGISTRY.getToolFunctions(
    toolkitId,
    toolId
  )
  const functionConfig = toolFunctions?.[functionName]

  if (!functionConfig) {
    // Try resolving via registry
    const resolved = TOOLKIT_REGISTRY.resolveToolById(toolId, toolkitId)
    if (!resolved) {
      return {
        type: 'executed',
        execution: {
          function: qualifiedName,
          status: 'error',
          observation: `Function "${qualifiedName}" not found in the registry.`
        }
      }
    }
    const resolvedFunctions = TOOLKIT_REGISTRY.getToolFunctions(
      resolved.toolkitId,
      resolved.toolId
    )
    if (!resolvedFunctions?.[functionName]) {
      return {
        type: 'executed',
        execution: {
          function: qualifiedName,
          status: 'error',
          observation: `Function "${functionName}" not found in tool "${resolved.toolId}". Available: ${resolvedFunctions ? Object.keys(resolvedFunctions).join(', ') : 'none'}.`
        }
      }
    }
  }

  const resolvedConfig = functionConfig || TOOLKIT_REGISTRY.getToolFunctions(
    toolkitId,
    toolId
  )?.[functionName]

  if (!resolvedConfig) {
    return {
      type: 'executed',
      execution: {
        function: qualifiedName,
        status: 'error',
        observation: `Could not resolve function config for "${qualifiedName}".`
      }
    }
  }

  // Ask the LLM to fill in tool_input
  return executeFunction(
    caller,
    toolkitId,
    toolId,
    functionName,
    step.label,
    resolvedConfig,
    executionHistory,
    agentSkillContext
  )
}

/**
 * Handles execution when the plan step refers to a tool (toolkit.tool)
 * rather than a fully-qualified function. Shows the tool's functions
 * and asks the LLM to pick one and provide input in a single step.
 */
async function runToolLevelExecution(
  caller: LLMCaller,
  qualifiedName: string,
  stepLabel: string,
  parts: string[],
  executionHistory: ExecutionRecord[],
  _catalog: Catalog,
  agentSkillContext: AgentSkillContext | null
): Promise<ExecutionStepResult> {
  const toolkitId = parts[0] || ''
  const toolId = parts[1] || parts[0] || ''

  LogHelper.title(`${DUTY_NAME} / execution`)
  LogHelper.debug(`Tool-level execution: resolving "${qualifiedName}"`)

  // Try to resolve the tool
  const resolved = TOOLKIT_REGISTRY.resolveToolById(toolId, toolkitId || undefined)
  const effectiveToolkitId = resolved?.toolkitId || toolkitId
  const effectiveToolId = resolved?.toolId || toolId

  const toolFunctions = TOOLKIT_REGISTRY.getToolFunctions(
    effectiveToolkitId,
    effectiveToolId
  )

  if (!toolFunctions || Object.keys(toolFunctions).length === 0) {
    LogHelper.debug(`No functions found for tool "${qualifiedName}"`)
    return {
      type: 'executed',
      execution: {
        function: qualifiedName,
        status: 'error',
        observation: `No functions found for tool "${qualifiedName}".`
      }
    }
  }

  const functionEntries = Object.entries(toolFunctions) as [string, FunctionConfig][]

  // If only one function, auto-select it
  if (functionEntries.length === 1) {
    const [fnName, fnConfig] = functionEntries[0]!
    LogHelper.debug(`Auto-selecting only function: ${fnName}`)
    return executeFunction(
      caller,
      effectiveToolkitId,
      effectiveToolId,
      fnName,
      stepLabel,
      fnConfig,
      executionHistory,
      agentSkillContext
    )
  }

  // Multiple functions — ask the LLM to pick one and provide input

  // --- Native tool calling path ---
  if (caller.supportsNativeTools) {
    return resolveToolFunctionWithNativeTools(
      caller,
      qualifiedName,
      stepLabel,
      effectiveToolkitId,
      effectiveToolId,
      toolFunctions as Record<string, FunctionConfig>,
      executionHistory,
      agentSkillContext
    )
  }

  // --- JSON mode fallback ---
  return resolveToolFunctionWithJSONMode(
    caller,
    qualifiedName,
    stepLabel,
    effectiveToolkitId,
    effectiveToolId,
    toolFunctions as Record<string, FunctionConfig>,
    functionEntries,
    executionHistory,
    agentSkillContext
  )
}

/**
 * Uses native tool calling with tool_choice='auto' to let the model pick
 * the right function from multiple options and provide arguments.
 */
async function resolveToolFunctionWithNativeTools(
  caller: LLMCaller,
  qualifiedName: string,
  stepLabel: string,
  toolkitId: string,
  toolId: string,
  toolFunctions: Record<string, FunctionConfig>,
  executionHistory: ExecutionRecord[],
  agentSkillContext: AgentSkillContext | null
): Promise<ExecutionStepResult> {
  const toolkitContextSection = buildToolkitContextSection(caller, toolkitId)
  const executionMemorySection = await buildExecutionMemorySection(
    caller,
    toolkitId
  )
  const contextManifestSection = buildExecutionContextManifestSection(
    caller,
    toolkitId,
    toolId
  )
  const activeAgentSkillSection =
    buildActiveAgentSkillSection(agentSkillContext)
  const historySection = formatExecutionHistory(executionHistory)
  const resolveSystemPrompt = buildPhaseSystemPrompt(
    RESOLVE_FUNCTION_SYSTEM_PROMPT,
    'execution'
  )

  const tools: OpenAITool[] = Object.entries(toolFunctions).map(
    ([fnName, fnConfig]) => ({
      type: 'function' as const,
      function: {
        name: fnName,
        description: fnConfig.description,
        parameters: fnConfig.parameters
      }
    })
  )

  const prompt = `<tool>\n${toolkitId}.${toolId}\n</tool>\n\n<current_plan_step>\n${stepLabel}\n</current_plan_step>\n\n${activeAgentSkillSection ? `${activeAgentSkillSection}\n\n` : ''}${toolkitContextSection}${contextManifestSection ? `\n\n${contextManifestSection}` : ''}\n\n${executionMemorySection}\n\n<execution_history>\n${historySection}\n</execution_history>\n\n<user_request>\n${caller.input}\n</user_request>\n\n<task>\nSelect the appropriate function for the current plan step and provide arguments.\n</task>`

  const result = await caller.callLLMWithTools(
    prompt,
    resolveSystemPrompt,
    tools,
    'auto',
    caller.history,
    false,
    buildExecutionPromptSections({
      prompt,
      systemPrompt: resolveSystemPrompt,
      baseSystemPromptContent: RESOLVE_FUNCTION_SYSTEM_PROMPT,
      promptSource:
        'server/src/core/llm-manager/llm-duties/react-llm-duty/execution.ts',
      systemPromptSource:
        'server/src/core/llm-manager/llm-duties/react-llm-duty/constants.ts',
      tools
    }),
    TOOL_ARGUMENT_LLM_OPTIONS
  )

  if (!result) {
    const providerError = caller.consumeProviderErrorMessage()
    if (providerError) {
      return {
        type: 'executed',
        execution: {
          function: qualifiedName,
          status: 'error',
          observation: providerError
        }
      }
    }

    return {
      type: 'executed',
      execution: {
        function: qualifiedName,
        status: 'error',
        observation: 'Failed to determine which function to call.'
      }
    }
  }

  if (result.toolCall) {
    const fnName = result.toolCall.functionName
    const fnConfig = toolFunctions[fnName]
    if (!fnConfig) {
      return {
        type: 'executed',
        execution: {
          function: `${toolkitId}.${toolId}.${fnName}`,
          status: 'error',
          observation: `Function "${fnName}" not found. Available: ${Object.keys(toolFunctions).join(', ')}.`
        }
      }
    }

    const toolInput = result.toolCall.arguments || '{}'
    return runToolExecution(
      toolkitId,
      toolId,
      fnName,
      toolInput,
      fnConfig,
      undefined,
      stepLabel
    )
  }

  // Text content fallback — parse for replan/handoff
  if (result.textContent) {
    const parsed = parseOutput(result.textContent)
    if (
      parsed?.['type'] === 'handoff' &&
      typeof parsed['draft'] === 'string' &&
      parsed['draft'].trim()
    ) {
      return createExecutionHandoff(
        parsed['draft'].trim(),
        parseExecutionHandoffIntent(parsed['intent']),
        'execution'
      )
    }
    if (
      parsed?.['type'] === 'final' &&
      typeof parsed['answer'] === 'string' &&
      parsed['answer'].trim()
    ) {
      return createExecutionHandoff(
        parsed['answer'].trim(),
        parseExecutionHandoffIntent(parsed['intent']),
        'execution'
      )
    }
    if (parsed?.['type'] === 'replan') {
      return {
        type: 'replan',
        reason: (parsed['reason'] as string) || 'Plan revision needed',
        steps: extractExecutionReplanSteps(parsed)
      }
    }
    if (parsed?.['type'] === 'execute') {
      const fnName = String(parsed['function_name'] || '')
        .split(/[./]/)
        .filter(Boolean)
        .pop() || ''
      const fnConfig = toolFunctions[fnName]
      if (!fnConfig) {
        return {
          type: 'executed',
          execution: {
            function: `${toolkitId}.${toolId}.${fnName}`,
            status: 'error',
            observation: `Function "${fnName}" not found. Available: ${Object.keys(toolFunctions).join(', ')}.`
          }
        }
      }

      const toolInput =
        typeof parsed['tool_input'] === 'string'
          ? (parsed['tool_input'] as string)
          : '{}'
      return runToolExecution(
        toolkitId,
        toolId,
        fnName,
        toolInput,
        fnConfig,
        undefined,
        stepLabel
      )
    }
  }

  return {
    type: 'executed',
    execution: {
      function: qualifiedName,
      status: 'error',
      observation: 'Could not resolve function from tool-level plan step.'
    }
  }
}

/**
 * JSON mode fallback for resolving which function to call when the plan
 * step refers to a tool with multiple functions.
 */
async function resolveToolFunctionWithJSONMode(
  caller: LLMCaller,
  qualifiedName: string,
  stepLabel: string,
  effectiveToolkitId: string,
  effectiveToolId: string,
  toolFunctions: Record<string, FunctionConfig>,
  functionEntries: [string, FunctionConfig][],
  executionHistory: ExecutionRecord[],
  agentSkillContext: AgentSkillContext | null
): Promise<ExecutionStepResult> {
  const toolkitContextSection = buildToolkitContextSection(
    caller,
    effectiveToolkitId
  )
  const executionMemorySection = await buildExecutionMemorySection(
    caller,
    effectiveToolkitId
  )
  const contextManifestSection = buildExecutionContextManifestSection(
    caller,
    effectiveToolkitId,
    effectiveToolId
  )
  const activeAgentSkillSection =
    buildActiveAgentSkillSection(agentSkillContext)
  const functionsSection = functionEntries
    .map(([fnName, fnConfig]) => {
      const params = JSON.stringify(fnConfig.parameters)
      return `- ${fnName}: ${fnConfig.description} ${params}`
    })
    .join('\n')

  const historySection = formatExecutionHistory(executionHistory)
  const resolveSystemPrompt = buildPhaseSystemPrompt(
    RESOLVE_FUNCTION_SYSTEM_PROMPT,
    'execution'
  )
  const prompt = `<tool>\n${effectiveToolkitId}.${effectiveToolId}\n</tool>\n\n<current_plan_step>\n${stepLabel}\n</current_plan_step>\n\n${activeAgentSkillSection ? `${activeAgentSkillSection}\n\n` : ''}${toolkitContextSection}${contextManifestSection ? `\n\n${contextManifestSection}` : ''}\n\n${executionMemorySection}\n\n<available_functions>\n${functionsSection}\n</available_functions>\n\n<execution_history>\n${historySection}\n</execution_history>\n\n<user_request>\n${caller.input}\n</user_request>\n\n<task>\nSelect the appropriate function for the current plan step and provide tool_input.\n</task>`

  const resolveSchema = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['execute', 'replan', 'handoff'] },
      function_name: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      tool_input: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      functions: {
        anyOf: [
          {
            type: 'array',
            items: { type: 'string' }
          },
          { type: 'null' }
        ]
      },
      steps: {
        anyOf: [
          {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                function: { type: 'string' },
                label: { type: 'string' }
              },
              required: ['function', 'label'],
              additionalProperties: false
            }
          },
          { type: 'null' }
        ]
      },
      reason: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      draft: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      intent: {
        anyOf: [
          {
            type: 'string',
            enum: ['answer', 'clarification', 'cancelled', 'blocked', 'error']
          },
          { type: 'null' }
        ]
      }
    },
    required: [
      'type',
      'function_name',
      'tool_input',
      'functions',
      'steps',
      'reason',
      'draft',
      'intent'
    ],
    additionalProperties: false
  }

  const completionResult = await caller.callLLM(
    prompt,
    resolveSystemPrompt,
    resolveSchema,
    caller.history,
    buildExecutionPromptSections({
      prompt,
      systemPrompt: resolveSystemPrompt,
      baseSystemPromptContent: RESOLVE_FUNCTION_SYSTEM_PROMPT,
      promptSource:
        'server/src/core/llm-manager/llm-duties/react-llm-duty/execution.ts',
      systemPromptSource:
        'server/src/core/llm-manager/llm-duties/react-llm-duty/constants.ts',
      schema: resolveSchema
    }),
    TOOL_ARGUMENT_LLM_OPTIONS
  )
  const parsed = parseOutput(completionResult?.output)

  if (!parsed) {
    return {
      type: 'executed',
      execution: {
        function: qualifiedName,
        status: 'error',
        observation: 'Failed to determine which function to call.'
      }
    }
  }

  if (
    parsed['type'] === 'handoff' &&
    typeof parsed['draft'] === 'string' &&
    parsed['draft'].trim()
  ) {
    return createExecutionHandoff(
      parsed['draft'].trim(),
      parseExecutionHandoffIntent(parsed['intent']),
      'execution'
    )
  }

  if (
    parsed['type'] === 'final' &&
    typeof parsed['answer'] === 'string' &&
    parsed['answer'].trim()
  ) {
    return createExecutionHandoff(
      parsed['answer'].trim(),
      parseExecutionHandoffIntent(parsed['intent']),
      'execution'
    )
  }

  if (parsed['type'] === 'replan') {
    return {
      type: 'replan',
      reason: (parsed['reason'] as string) || 'Plan revision needed',
      steps: extractExecutionReplanSteps(parsed)
    }
  }

  if (parsed['type'] === 'execute' && parsed['function_name']) {
    const fnName = (parsed['function_name'] as string)
      .split(/[./]/)
      .filter(Boolean)
      .pop() || ''
    const fnConfig = toolFunctions[fnName]
    if (!fnConfig) {
      return {
        type: 'executed',
        execution: {
          function: `${effectiveToolkitId}.${effectiveToolId}.${fnName}`,
          status: 'error',
          observation: `Function "${fnName}" not found. Available: ${Object.keys(toolFunctions).join(', ')}.`
        }
      }
    }

    const toolInput = (parsed['tool_input'] as string) || '{}'
    return runToolExecution(
      effectiveToolkitId,
      effectiveToolId,
      fnName,
      toolInput,
      fnConfig,
      undefined,
      stepLabel
    )
  }

  return {
    type: 'executed',
    execution: {
      function: qualifiedName,
      status: 'error',
      observation: 'Could not resolve function from tool-level plan step.'
    }
  }
}

/**
 * Asks the LLM to fill tool_input for a known function, then executes it.
 * Uses native tool calling for supported providers, falls back to JSON mode.
 * Retries on invalid input up to MAX_RETRIES_PER_FUNCTION.
 */
async function executeFunction(
  caller: LLMCaller,
  toolkitId: string,
  toolId: string,
  functionName: string,
  stepLabel: string,
  functionConfig: FunctionConfig,
  executionHistory: ExecutionRecord[],
  agentSkillContext: AgentSkillContext | null
): Promise<ExecutionStepResult> {
  // --- Native tool calling path ---
  if (caller.supportsNativeTools) {
    return executeFunctionWithNativeTools(
      caller,
      toolkitId,
      toolId,
      functionName,
      stepLabel,
      functionConfig,
      executionHistory,
      agentSkillContext
    )
  }

  // --- JSON mode fallback ---
  return executeFunctionWithJSONMode(
    caller,
    toolkitId,
    toolId,
    functionName,
    stepLabel,
    functionConfig,
    executionHistory,
    agentSkillContext
  )
}

/**
 * Uses native OpenAI-style tool calling to fill tool_input.
 */
async function executeFunctionWithNativeTools(
  caller: LLMCaller,
  toolkitId: string,
  toolId: string,
  functionName: string,
  stepLabel: string,
  functionConfig: FunctionConfig,
  executionHistory: ExecutionRecord[],
  agentSkillContext: AgentSkillContext | null
): Promise<ExecutionStepResult> {
  const qualifiedName = `${toolkitId}.${toolId}.${functionName}`
  const currentStepLabel = stepLabel || qualifiedName
  const currentStepNumber = executionHistory.length + 1
  const previousInputsSection = buildPreviouslyUsedInputsSection(
    executionHistory,
    qualifiedName
  )
  const toolkitContextSection = buildToolkitContextSection(caller, toolkitId)
  const executionMemorySection = await buildExecutionMemorySection(
    caller,
    toolkitId
  )
  const contextManifestSection = buildExecutionContextManifestSection(
    caller,
    toolkitId,
    toolId
  )
  const activeAgentSkillSection =
    buildActiveAgentSkillSection(agentSkillContext)
  const historySection = formatExecutionHistory(executionHistory)
  const executeSystemPrompt = buildPhaseSystemPrompt(
    EXECUTE_SYSTEM_PROMPT,
    'execution'
  )

  const tool: OpenAITool = {
    type: 'function',
    function: {
      name: functionName,
      description: functionConfig.description,
      parameters: functionConfig.parameters
    }
  }

  let retries = 0
  let lastError = ''
  let toolFailureRetries = 0
  let lastFailedToolInput: string | null = null
  const attemptedInputsInCurrentStep = new Set<string>()

  const runValidatedToolInput = async (
    toolInputRaw: string
  ): Promise<ToolExecutionResult | { retry: true }> => {
    const inputValidation = validateToolInput(
      toolInputRaw,
      functionConfig.parameters
    )
    if (!inputValidation.isValid) {
      retries += 1
      lastError = inputValidation.message || 'tool arguments do not match schema'
      return { retry: true }
    }

    const validatedToolInput = inputValidation.repairedToolInput ?? toolInputRaw
    const duplicateInputMatch = findDuplicateToolInputMatch(
      executionHistory,
      qualifiedName,
      currentStepLabel,
      validatedToolInput
    )
    if (duplicateInputMatch) {
      retries += 1
      const previousStepLabel = duplicateInputMatch.stepLabel
        ? `"${duplicateInputMatch.stepLabel}"`
        : '(no label)'
      lastError = `tool_input duplicates Step ${duplicateInputMatch.stepNumber} ${previousStepLabel}; provide different arguments for the current step`
      LogHelper.title(`${DUTY_NAME} / execution`)
      LogHelper.debug(
        `Rejected duplicate tool_input for "${qualifiedName}" at step ${currentStepNumber}: matches step ${duplicateInputMatch.stepNumber}`
      )
      return { retry: true }
    }
    const normalizedCurrentAttempt = normalizeToolInputForComparison(
      validatedToolInput
    )
    if (
      normalizedCurrentAttempt &&
      attemptedInputsInCurrentStep.has(normalizedCurrentAttempt)
    ) {
      retries += 1
      lastError = 'tool_input duplicates a previous attempt for the current step'
      LogHelper.title(`${DUTY_NAME} / execution`)
      LogHelper.debug(
        `Rejected duplicate retry tool_input for "${qualifiedName}" at step ${currentStepNumber}`
      )
      return { retry: true }
    }
    if (normalizedCurrentAttempt) {
      attemptedInputsInCurrentStep.add(normalizedCurrentAttempt)
    }

    const toolResult = await runToolExecution(
      toolkitId,
      toolId,
      functionName,
      validatedToolInput,
      functionConfig,
      inputValidation.parsedValue,
      currentStepLabel
    )

    if (toolResult.handoffSignal) {
      return toolResult
    }

    if (toolResult.execution.status === 'error') {
      if (toolFailureRetries < MAX_TOOL_FAILURE_RETRIES) {
        toolFailureRetries += 1
        lastError = extractFailureMessageFromObservation(
          toolResult.execution.observation
        )
        lastFailedToolInput = validatedToolInput
        return { retry: true }
      }
    }

    return toolResult
  }

  while (retries <= MAX_RETRIES_PER_FUNCTION) {
    const retryNote = lastError
      ? `\n\nPrevious attempt failed: ${lastError}.${lastFailedToolInput ? `\nPrevious failed tool_input: ${lastFailedToolInput}\nDo not reuse the same tool_input. Change the arguments to address the failure.` : ' Please fix the arguments.'}`
      : ''
    const prompt = `<current_plan_step>\nNumber: ${currentStepNumber}\nLabel: ${currentStepLabel}\nInstruction: Execute only this step now and focus on this step objective.${previousInputsSection}\n</current_plan_step>\n\n${activeAgentSkillSection ? `${activeAgentSkillSection}\n\n` : ''}${toolkitContextSection}${contextManifestSection ? `\n\n${contextManifestSection}` : ''}\n\n${executionMemorySection}\n\n<execution_history>\n${historySection}\n</execution_history>\n\n<user_request>\n${caller.input}\n</user_request>${retryNote ? `\n\n<retry_context>\n${retryNote.trim()}\n</retry_context>` : ''}`

    const result = await caller.callLLMWithTools(
      prompt,
      executeSystemPrompt,
      [tool],
      'auto',
      caller.history,
      false,
      buildExecutionPromptSections({
        prompt,
        systemPrompt: executeSystemPrompt,
        baseSystemPromptContent: EXECUTE_SYSTEM_PROMPT,
        promptSource:
          'server/src/core/llm-manager/llm-duties/react-llm-duty/execution.ts',
        systemPromptSource:
          'server/src/core/llm-manager/llm-duties/react-llm-duty/constants.ts',
        tools: [tool]
      }),
      TOOL_ARGUMENT_LLM_OPTIONS
    )

    if (!result) {
      const providerError = caller.consumeProviderErrorMessage()
      if (providerError) {
        LogHelper.title(`${DUTY_NAME} / execution`)
        LogHelper.warning(
          `Execution aborted for "${qualifiedName}": ${providerError}`
        )
        return {
          type: 'executed',
          execution: {
            function: qualifiedName,
            status: 'error',
            observation: providerError
          }
        }
      }

      const providerFailureObservation =
        'Provider did not return a response (timeout or network issue).'
      LogHelper.title(`${DUTY_NAME} / execution`)
      LogHelper.warning(
        `Execution aborted for "${qualifiedName}": ${providerFailureObservation}`
      )
      return {
        type: 'executed',
        execution: {
          function: qualifiedName,
          status: 'error',
          observation: providerFailureObservation
        }
      }
    }

    // Model returned a tool call — extract and validate arguments
    if (result.toolCall) {
      const toolInput = result.toolCall.arguments || '{}'
      const toolResult = await runValidatedToolInput(toolInput)
      if ('retry' in toolResult) {
        continue
      }
      return toolResult
    }

    // Model responded with text instead of a tool call — parse for replan/handoff
    if (result.textContent) {
      const parsed = parseOutput(result.textContent)
      if (
        parsed?.['type'] === 'handoff' &&
        typeof parsed['draft'] === 'string' &&
        parsed['draft'].trim()
      ) {
        return createExecutionHandoff(
          parsed['draft'].trim(),
          parseExecutionHandoffIntent(parsed['intent']),
          'execution'
        )
      }
      if (
        parsed?.['type'] === 'final' &&
        typeof parsed['answer'] === 'string' &&
        parsed['answer'].trim()
      ) {
        return createExecutionHandoff(
          parsed['answer'].trim(),
          parseExecutionHandoffIntent(parsed['intent']),
          'execution'
        )
      }
      if (parsed?.['type'] === 'replan') {
        return {
          type: 'replan',
          reason: (parsed['reason'] as string) || 'Plan revision needed',
          steps: extractExecutionReplanSteps(parsed)
        }
      }
      if (parsed?.['type'] === 'execute') {
        const parsedFunctionName =
          typeof parsed['function_name'] === 'string'
            ? (parsed['function_name'] as string).trim()
            : ''
        const parsedToolInput =
          typeof parsed['tool_input'] === 'string'
            ? (parsed['tool_input'] as string)
            : '{}'

        if (parsedFunctionName) {
          const parsedLeaf = parsedFunctionName
            .split(/[./]/)
            .filter(Boolean)
            .pop()
          if (parsedLeaf && parsedLeaf !== functionName) {
            retries += 1
            lastError = `model selected unexpected function "${parsedFunctionName}" while executing "${functionName}"`
            continue
          }
        }

        const toolResult = await runValidatedToolInput(parsedToolInput)
        if ('retry' in toolResult) {
          continue
        }
        return toolResult
      }
    }

    retries += 1
    lastError = 'Model did not produce a tool call'
  }

  return {
    type: 'executed',
    execution: {
      function: qualifiedName,
      status: 'error',
      observation: `Failed after ${MAX_RETRIES_PER_FUNCTION + 1} attempts: ${lastError}`
    }
  }
}

/**
 * JSON mode fallback for providers that do not support native tool calling.
 * The function signature is injected into the prompt text and the LLM
 * returns structured JSON with the tool_input.
 */
async function executeFunctionWithJSONMode(
  caller: LLMCaller,
  toolkitId: string,
  toolId: string,
  functionName: string,
  stepLabel: string,
  functionConfig: FunctionConfig,
  executionHistory: ExecutionRecord[],
  agentSkillContext: AgentSkillContext | null
): Promise<ExecutionStepResult> {
  const qualifiedName = `${toolkitId}.${toolId}.${functionName}`
  const currentStepLabel = stepLabel || qualifiedName
  const currentStepNumber = executionHistory.length + 1
  const previousInputsSection = buildPreviouslyUsedInputsSection(
    executionHistory,
    qualifiedName
  )
  const paramsSchema = JSON.stringify(functionConfig.parameters)
  const toolkitContextSection = buildToolkitContextSection(caller, toolkitId)
  const executionMemorySection = await buildExecutionMemorySection(
    caller,
    toolkitId
  )
  const contextManifestSection = buildExecutionContextManifestSection(
    caller,
    toolkitId,
    toolId
  )
  const activeAgentSkillSection =
    buildActiveAgentSkillSection(agentSkillContext)
  const historySection = formatExecutionHistory(executionHistory)
  const executeSystemPrompt = buildPhaseSystemPrompt(
    EXECUTE_SYSTEM_PROMPT,
    'execution'
  )

  const executeSchema = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['execute', 'replan', 'handoff'] },
      function_name: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      tool_input: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      functions: {
        anyOf: [
          {
            type: 'array',
            items: { type: 'string' }
          },
          { type: 'null' }
        ]
      },
      reason: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      draft: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      intent: {
        anyOf: [
          {
            type: 'string',
            enum: ['answer', 'clarification', 'cancelled', 'blocked', 'error']
          },
          { type: 'null' }
        ]
      }
    },
    required: [
      'type',
      'function_name',
      'tool_input',
      'functions',
      'reason',
      'draft',
      'intent'
    ],
    additionalProperties: false
  }

  let retries = 0
  let lastError = ''
  let toolFailureRetries = 0
  let lastFailedToolInput: string | null = null
  const attemptedInputsInCurrentStep = new Set<string>()

  while (retries <= MAX_RETRIES_PER_FUNCTION) {
    const retryNote = lastError
      ? `\n\nPrevious attempt failed: ${lastError}.${lastFailedToolInput ? `\nPrevious failed tool_input: ${lastFailedToolInput}\nDo not reuse the same tool_input. Change the arguments to address the failure.` : ' Please fix the tool_input.'}`
      : ''
    const prompt = `<function>\nName: ${qualifiedName}\nDescription: ${functionConfig.description}\n</function>\n\n<current_plan_step>\nNumber: ${currentStepNumber}\nLabel: ${currentStepLabel}\nInstruction: Execute only this step now and focus on this step objective.${previousInputsSection}\n</current_plan_step>\n\n<parameters_schema>\n${paramsSchema}\n</parameters_schema>\n\n${activeAgentSkillSection ? `${activeAgentSkillSection}\n\n` : ''}${toolkitContextSection}${contextManifestSection ? `\n\n${contextManifestSection}` : ''}\n\n${executionMemorySection}\n\n<execution_history>\n${historySection}\n</execution_history>\n\n<user_request>\n${caller.input}\n</user_request>${retryNote ? `\n\n<retry_context>\n${retryNote.trim()}\n</retry_context>` : ''}\n\n<task>\nProvide the tool_input for this function.\n</task>`

    const completionResult = await caller.callLLM(
      prompt,
      executeSystemPrompt,
      executeSchema,
      caller.history,
      buildExecutionPromptSections({
        prompt,
        systemPrompt: executeSystemPrompt,
        baseSystemPromptContent: EXECUTE_SYSTEM_PROMPT,
        promptSource:
          'server/src/core/llm-manager/llm-duties/react-llm-duty/execution.ts',
        systemPromptSource:
          'server/src/core/llm-manager/llm-duties/react-llm-duty/constants.ts',
        schema: executeSchema
      }),
      TOOL_ARGUMENT_LLM_OPTIONS
    )
    if (!completionResult) {
      const providerFailureObservation =
        'Provider did not return a response (timeout or network issue).'
      LogHelper.title(`${DUTY_NAME} / execution`)
      LogHelper.warning(
        `Execution aborted for "${qualifiedName}": ${providerFailureObservation}`
      )
      return {
        type: 'executed',
        execution: {
          function: qualifiedName,
          status: 'error',
          observation: providerFailureObservation
        }
      }
    }

    const parsed = parseOutput(completionResult?.output)

    if (!parsed) {
      retries += 1
      lastError = 'Failed to produce valid output'
      continue
    }

    if (
      parsed['type'] === 'handoff' &&
      typeof parsed['draft'] === 'string' &&
      parsed['draft'].trim()
    ) {
      return createExecutionHandoff(
        parsed['draft'].trim(),
        parseExecutionHandoffIntent(parsed['intent']),
        'execution'
      )
    }

    if (
      parsed['type'] === 'final' &&
      typeof parsed['answer'] === 'string' &&
      parsed['answer'].trim()
    ) {
      return createExecutionHandoff(
        parsed['answer'].trim(),
        parseExecutionHandoffIntent(parsed['intent']),
        'execution'
      )
    }

    if (parsed['type'] === 'replan') {
      return {
        type: 'replan',
        reason: (parsed['reason'] as string) || 'Plan revision needed',
        steps: extractExecutionReplanSteps(parsed)
      }
    }

    if (parsed['type'] === 'execute') {
      const toolInput = (parsed['tool_input'] as string) || '{}'

      // Validate input
      const inputValidation = validateToolInput(
        toolInput,
        functionConfig.parameters
      )
      if (!inputValidation.isValid) {
        retries += 1
        lastError =
          inputValidation.message || 'tool_input does not match schema'
        continue
      }

      const validatedToolInput =
        inputValidation.repairedToolInput ?? toolInput
      const duplicateInputMatch = findDuplicateToolInputMatch(
        executionHistory,
        qualifiedName,
        currentStepLabel,
        validatedToolInput
      )
      if (duplicateInputMatch) {
        retries += 1
        const previousStepLabel = duplicateInputMatch.stepLabel
          ? `"${duplicateInputMatch.stepLabel}"`
          : '(no label)'
        lastError = `tool_input duplicates Step ${duplicateInputMatch.stepNumber} ${previousStepLabel}; provide different arguments for the current step`
        LogHelper.title(`${DUTY_NAME} / execution`)
        LogHelper.debug(
          `Rejected duplicate tool_input for "${qualifiedName}" at step ${currentStepNumber}: matches step ${duplicateInputMatch.stepNumber}`
        )
        continue
      }
      const normalizedCurrentAttempt = normalizeToolInputForComparison(
        validatedToolInput
      )
      if (
        normalizedCurrentAttempt &&
        attemptedInputsInCurrentStep.has(normalizedCurrentAttempt)
      ) {
        retries += 1
        lastError =
          'tool_input duplicates a previous attempt for the current step'
        LogHelper.title(`${DUTY_NAME} / execution`)
        LogHelper.debug(
          `Rejected duplicate retry tool_input for "${qualifiedName}" at step ${currentStepNumber}`
        )
        continue
      }
      if (normalizedCurrentAttempt) {
        attemptedInputsInCurrentStep.add(normalizedCurrentAttempt)
      }

      const toolResult = await runToolExecution(
        toolkitId,
        toolId,
        functionName,
        validatedToolInput,
        functionConfig,
        inputValidation.parsedValue,
        currentStepLabel
      )

      if (toolResult.handoffSignal) {
        return toolResult
      }

      if (toolResult.execution.status === 'error') {
        if (toolFailureRetries < MAX_TOOL_FAILURE_RETRIES) {
          toolFailureRetries += 1
          lastError = extractFailureMessageFromObservation(
            toolResult.execution.observation
          )
          lastFailedToolInput = validatedToolInput
          continue
        }
      }

      return toolResult
    }

    retries += 1
    lastError = 'Unexpected response type'
  }

  return {
    type: 'executed',
    execution: {
      function: qualifiedName,
      status: 'error',
      observation: `Failed after ${MAX_RETRIES_PER_FUNCTION + 1} attempts: ${lastError}`
    }
  }
}

/**
 * Actually executes a tool via TOOL_EXECUTOR and processes the result.
 */
export async function runToolExecution(
  toolkitId: string,
  toolId: string,
  functionName: string,
  toolInput: string,
  _functionConfig: FunctionConfig,
  parsedInput?: Record<string, unknown>,
  stepLabel?: string
): Promise<ToolExecutionResult> {
  const qualifiedName = `${toolkitId}.${toolId}.${functionName}`
  const requestedToolInput = toolInput

  const toolExecutionInput: {
    toolId: string
    toolkitId: string
    functionName: string
    toolInput: string
    parsedInput?: Record<string, unknown>
    onProgress?: (progress: { message: string, key?: string }) => void
  } = {
    toolId,
    toolkitId,
    functionName,
    toolInput
  }

  if (parsedInput) {
    toolExecutionInput.parsedInput = parsedInput
  }

  if (!toolExecutionInput.parsedInput) {
    try {
      const parsedToolInput = JSON.parse(toolInput)
      if (
        parsedToolInput &&
        typeof parsedToolInput === 'object' &&
        !Array.isArray(parsedToolInput)
      ) {
        toolExecutionInput.parsedInput =
          parsedToolInput as Record<string, unknown>
      }
    } catch {
      // Leave parsedInput unset; downstream validation will surface invalid JSON.
    }
  }

  // For bash commands, write the command to a temp script file so that
  // base-tool's escapeShellArg does not destroy shell metacharacters
  // (quotes, pipes, redirects, etc.). The bash tool receives a simple
  // file path instead of a raw command string.
  let bashScriptPath: string | null = null
  if (
    toolId === 'bash' &&
    functionName === 'executeBashCommand' &&
    toolExecutionInput.parsedInput?.['command']
  ) {
    const command = toolExecutionInput.parsedInput['command'] as string
    const scriptDir = join(tmpdir(), 'leon_bash_scripts')
    mkdirSync(scriptDir, { recursive: true })
    bashScriptPath = join(
      scriptDir,
      `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.sh`
    )
    const managedRuntimeFunctions = RuntimeHelper.buildManagedRuntimeShellFunctions()
    writeFileSync(
      bashScriptPath,
      [
        '# Leon-injected managed runtime shims. This block is not generated by the LLM.',
        managedRuntimeFunctions,
        '',
        '# LLM-generated bash command starts here.',
        'set -e',
        command,
        ''
      ].join('\n'),
      { mode: 0o755 }
    )

    // Replace the command with the script path
    toolExecutionInput.parsedInput = {
      ...toolExecutionInput.parsedInput,
      command: bashScriptPath
    }
    toolExecutionInput.toolInput = JSON.stringify(
      toolExecutionInput.parsedInput
    )
  }

  LogHelper.title(`${DUTY_NAME} / execution`)
  LogHelper.debug(`Running tool: ${qualifiedName}`)
  LogHelper.debug(`Tool input: ${toolInput}`)

  const toolGroupId = createToolGroupId(toolkitId, toolId, functionName)
  emitToolExecutionInputToWebApp({
    toolkitId,
    toolId,
    functionName,
    toolInput: requestedToolInput,
    toolGroupId,
    ...(stepLabel ? { stepLabel } : {})
  })

  const toolDisplayContext = getToolDisplayContext(
    toolkitId,
    toolId,
    functionName
  )
  let didNotifyOwnerPreparationStarted = false
  let didNotifyOwnerPreparationReady = false
  let didObservePreparationFailure = false
  toolExecutionInput.onProgress = (progress): void => {
    emitToolPreparationProgressToWebApp({
      toolkitId,
      toolId,
      functionName,
      toolGroupId,
      message: progress.message,
      ...(stepLabel ? { stepLabel } : {})
    })

    if (!progress.key) {
      return
    }

    if (TOOL_PREPARATION_FAILED_REPORT_KEYS.has(progress.key)) {
      didObservePreparationFailure = true
      return
    }

    if (
      !didNotifyOwnerPreparationStarted &&
      TOOL_PREPARATION_STARTED_REPORT_KEYS.has(progress.key)
    ) {
      didNotifyOwnerPreparationStarted = true
      emitToolPreparationOwnerMessage(
        'react.tool.preparing',
        toolDisplayContext.toolName
      )
      return
    }

    if (
      didNotifyOwnerPreparationStarted &&
      !didNotifyOwnerPreparationReady &&
      !didObservePreparationFailure &&
      TOOL_PREPARATION_READY_REPORT_KEYS.has(progress.key)
    ) {
      didNotifyOwnerPreparationReady = true
      emitToolPreparationOwnerMessage(
        'react.tool.ready',
        toolDisplayContext.toolName
      )
    }
  }

  const toolExecutionResult =
    await TOOL_EXECUTOR.executeTool(toolExecutionInput)
  const toolOutput = toolExecutionResult.data?.output || {}
  const nestedResult = asRecord(toolOutput['result'])
  const toolOutputSuccess = toolOutput['success']
  const nestedResultSuccess = nestedResult?.['success']
  const toolOutputError =
    typeof toolOutput['error'] === 'string'
      ? toolOutput['error']
      : null
  const nestedResultError =
    typeof nestedResult?.['error'] === 'string'
      ? nestedResult['error']
      : null
  const hasDomainFailure =
    toolExecutionResult.status === 'success' &&
    (toolOutputSuccess === false || nestedResultSuccess === false)
  const effectiveStatus = hasDomainFailure
    ? 'error'
    : toolExecutionResult.status
  const effectiveMessage =
    (hasDomainFailure && (nestedResultError || toolOutputError)) ||
    toolExecutionResult.message

  LogHelper.title(`${DUTY_NAME} / execution`)
  if (hasDomainFailure) {
    LogHelper.warning(
      'Tool result normalized to [error]: tool output reported success=false'
    )
  }
  if (effectiveStatus !== 'success') {
    LogHelper.debug(
      `Tool result: ${qualifiedName} [${effectiveStatus}] — ${effectiveMessage}`
    )
  }
  LogHelper.debug(
    `Tool output: ${JSON.stringify(toolExecutionResult.data?.output)}`
  )

  emitToolExecutionOutputToWebApp({
    toolkitId,
    toolId,
    functionName,
    toolGroupId,
    output: toolExecutionResult.data?.output || {},
    status: effectiveStatus,
    message: effectiveMessage,
    ...(stepLabel ? { stepLabel } : {})
  })

  // Check for final_answer in tool result
  const finalAnswer =
    effectiveStatus === 'success'
      ? extractFinalAnswerFromToolResult(toolExecutionResult)
      : null
  if (finalAnswer) {
    return {
      type: 'executed',
      execution: {
        function: qualifiedName,
        status: 'success',
        observation: finalAnswer,
        requestedToolInput,
        ...(stepLabel ? { stepLabel } : {})
      },
      handoffSignal: {
        intent: 'answer',
        draft: finalAnswer,
        source: 'tool'
      }
    }
  }

  // Check for missing settings
  const missingSettings =
    effectiveStatus === 'error'
      ? ((toolOutput['missing_settings'] as
          | string[]
          | undefined) ??
        (nestedResult?.['missing_settings'] as
          | string[]
          | undefined))
      : undefined
  const settingsPath =
    effectiveStatus === 'error'
      ? ((toolOutput['settings_path'] as
          | string
          | undefined) ??
        (nestedResult?.['settings_path'] as
          | string
          | undefined))
      : undefined
  if (missingSettings && missingSettings.length > 0 && settingsPath) {
    const formattedPath = formatFilePath(settingsPath)
    return {
      type: 'executed',
      execution: {
        function: qualifiedName,
        status: 'error',
        observation: `Missing settings: ${missingSettings.join(', ')}`,
        requestedToolInput,
        ...(stepLabel ? { stepLabel } : {})
      },
      handoffSignal: {
        intent: 'blocked',
        draft: `Missing tool settings: ${missingSettings.join(
          ', '
        )}. Please set them in ${formattedPath}.`,
        source: 'tool'
      }
    }
  }

  const observation = JSON.stringify({
    status: effectiveStatus,
    ...(effectiveStatus !== toolExecutionResult.status
      ? { raw_status: toolExecutionResult.status }
      : {}),
    message: effectiveMessage,
    data: toolExecutionResult.data,
    ...(hasDomainFailure
      ? {
          tool_output_failure: {
            success: nestedResultSuccess ?? toolOutputSuccess,
            error: nestedResultError || toolOutputError || effectiveMessage
          }
        }
      : {})
  })

  return {
    type: 'executed',
    execution: {
      function: qualifiedName,
      status: effectiveStatus,
      observation,
      requestedToolInput,
      ...(stepLabel ? { stepLabel } : {})
    }
  }
}
