import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import YAML from 'yaml'

import type { LLMModelReasoning } from '../../../server/src/core/llm-manager/llm-model-catalog'
import type { MessageLog } from '../../../server/src/types'
import type { AgentProvider } from './provider-matrix'
import { PROVIDER_MATRIX, PROVIDER_REQUIRED_ENV } from './provider-matrix'
import {
  getProviderScenario,
  type ProviderScenarioId
} from './provider-scenarios'

const RESULT_PREFIX = '__AGENT_RESULT__'
const PROGRESS_PREFIX = '__AGENT_PROGRESS__'
const TEST_HOME_PREFIX = 'leon-agent-e2e'
const TEST_PROFILE_PREFIX = 'agent-e2e'
const SOURCE_CONFIG_PATH_ENV = 'LEON_AGENT_E2E_SOURCE_CONFIG_PATH'
const EMPTY_PROFILE_DISABLED_CONFIG = {
  skills: [],
  tools: []
}
const AGENT_CONTINUATION_STATE_FILENAME =
  '.agent-loop-continuation-state.json'
const LEGACY_AGENT_HISTORY_COMPACTION_STATE_FILENAME =
  '.react-history-compaction-state.json'
const PROVIDER_UNAVAILABLE_PATTERNS = [
  /cannot find llama\.cpp model/i,
  /credit balance is too low/i,
  /insufficient[_\s-]?quota/i,
  /no default installed local llm was found/i,
  /no llm is configured/i,
  /rate limit/i,
  /\b429\b/i
]

interface AgentProgressEvent {
  provider: AgentProvider
  stage:
    | 'bootstrap'
    | 'turn_start'
    | 'tool_call'
    | 'turn_result'
    | 'scenario_complete'
  turn?: number
  message: string
  data?: Record<string, unknown>
}

interface AgentTurnResult {
  input: string
  output: string
  finalIntent: string | null
  executionHistory: Array<{
    function: string
    status: string
    observation: string
    stepLabel?: string
    requestedToolInput?: string
  }>
  toolCalls: Array<{
    toolkitId?: string
    toolId: string
    functionName?: string
    toolInput?: string
    parsedInput?: Record<string, unknown>
    toolOutput?: string
  }>
}

interface AgentRunnerResult {
  provider: AgentProvider
  scenarioId: ProviderScenarioId
  skipped: boolean
  reason?: string
  assetPath?: string
  turn?: AgentTurnResult
}

type ConversationLoggerRecord = Omit<MessageLog, 'sentAt'>

function printResult(result: AgentRunnerResult): void {
  /**
   * A fixed marker makes it easy for the parent Vitest process to extract the
   * structured result from mixed stdout/stderr.
   */
  console.log(`${RESULT_PREFIX}${JSON.stringify(result)}`)
}

function printProgress(event: AgentProgressEvent): void {
  console.log(`${PROGRESS_PREFIX}${JSON.stringify(event)}`)
}

function serializeToolOutput(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function summarizeValue(value: string, maxLength = 220): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength)}...`
}

function createConversationLoggerRecord(
  who: MessageLog['who'],
  message: string
): ConversationLoggerRecord {
  return {
    who,
    message,
    isAddedToHistory: true
  }
}

function getProviderUnavailableReason(value: unknown): string | null {
  const message =
    value instanceof Error
      ? `${value.name}: ${value.message}\n${value.stack || ''}`
      : String(value || '')

  if (
    PROVIDER_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return summarizeValue(message.replace(/\s+/g, ' ').trim(), 500)
  }

  return null
}

async function removeTestHomePath(
  homePath: string,
  expectedHomePath: string
): Promise<void> {
  const resolvedHomePath = path.resolve(homePath)
  const resolvedExpectedHomePath = path.resolve(expectedHomePath)

  if (
    resolvedHomePath !== resolvedExpectedHomePath ||
    path.dirname(resolvedHomePath) !== os.tmpdir() ||
    !path.basename(resolvedHomePath).startsWith(`${TEST_HOME_PREFIX}-`)
  ) {
    throw new Error(`Refusing to remove non-test Leon home path: ${homePath}`)
  }

  await fs.rm(resolvedHomePath, { force: true, recursive: true })
}

async function prepareTestProfilePath(
  directories: string[],
  disabledConfigPath: string
): Promise<void> {
  await Promise.all(
    directories.map((directory) => fs.mkdir(directory, { recursive: true }))
  )

  await fs.writeFile(
    disabledConfigPath,
    `${JSON.stringify(EMPTY_PROFILE_DISABLED_CONFIG, null, 2)}\n`,
    'utf8'
  )
}

/** Seeds an isolated profile from the active profile configuration. */
async function prepareTestProfileConfig(
  sourceConfigPath: string,
  targetConfigPath: string,
  llmTarget: string,
  reasoning: LLMModelReasoning | null
): Promise<void> {
  if (!sourceConfigPath || !await fs.stat(sourceConfigPath).then(
    (stat) => stat.isFile(),
    () => false
  )) {
    throw new Error(
      `The source profile configuration does not exist: ${sourceConfigPath || '(missing path)'}`
    )
  }

  const sourceConfig = await fs.readFile(sourceConfigPath, 'utf8')
  const document = YAML.parseDocument(sourceConfig)

  if (document.errors.length > 0) {
    throw new Error(
      `The source profile configuration is invalid: ${document.errors.join('; ')}`
    )
  }

  // Keep real provider settings while making the matrix target authoritative.
  document.setIn(['llm', 'default'], llmTarget)
  document.setIn(['llm', 'workflow'], null)
  document.setIn(['llm', 'agent'], null)
  if (reasoning) {
    document.setIn(
      ['llm', 'model_settings', llmTarget, 'reasoning'],
      reasoning
    )
  }

  await fs.mkdir(path.dirname(targetConfigPath), { recursive: true })
  await fs.writeFile(targetConfigPath, String(document), 'utf8')
}

async function main(): Promise<void> {
  const providerArg = process.argv[2] as AgentProvider | undefined
  const scenarioArg = process.argv[3]
  const scenario = getProviderScenario(scenarioArg)
  const resultScenarioId = (scenarioArg || 'direct_answer') as ProviderScenarioId

  if (!providerArg || !(providerArg in PROVIDER_REQUIRED_ENV) || !scenario) {
    printResult({
      provider: (providerArg || 'openai') as AgentProvider,
      scenarioId: resultScenarioId,
      skipped: true,
      reason: !scenario ? 'invalid_scenario' : 'invalid_provider'
    })
    return
  }

  const provider = providerArg
  const providerConfig = PROVIDER_MATRIX.find(
    (item) => item.provider === provider
  )
  const llmTarget = providerConfig?.llmTarget || provider
  const requiredEnv = PROVIDER_REQUIRED_ENV[provider]
  const testRunId = `${provider}-${scenario.id}-${process.pid}-${Date.now()}`
  const testProfileName = `${TEST_PROFILE_PREFIX}-${testRunId}`
  const testHomePath = path.join(
    os.tmpdir(),
    `${TEST_HOME_PREFIX}-${testRunId}`
  )
  const testProfilePath = path.join(
    testHomePath,
    'profiles',
    testProfileName
  )
  const testConfigPath = path.join(testProfilePath, 'config.yml')
  if (!process.env[requiredEnv]) {
    printResult({
      provider,
      scenarioId: scenario.id,
      skipped: true,
      reason: `missing_${requiredEnv.toLowerCase()}`
    })
    return
  }

  process.env['LEON_NODE_ENV'] = 'testing'
  process.env['LEON_LLM'] = llmTarget
  process.env['LEON_HOME'] = testHomePath
  process.env['LEON_PROFILE'] = testProfileName

  await prepareTestProfileConfig(
    String(process.env[SOURCE_CONFIG_PATH_ENV] || '').trim(),
    testConfigPath,
    llmTarget,
    providerConfig?.reasoning || null
  )

  const tempAssetPath = path.join(
    os.tmpdir(),
    `leon-agent-${provider}-${scenario.id}-${Date.now()}.txt`
  )

  const {
    CACHE_PATH,
    LEON_PROFILE_PATH,
    LEON_PROFILES_PATH,
    LEON_HOME_PATH,
    LEON_TOOLKITS_PATH,
    MODELS_PATH,
    PROFILE_AGENT_SKILLS_PATH,
    PROFILE_CONTEXT_PATH,
    PROFILE_DISABLED_PATH,
    PROFILE_LOGS_PATH,
    PROFILE_MEMORY_PATH,
    PROFILE_NATIVE_SKILLS_PATH,
    PROFILE_SKILLS_PATH,
    PROFILE_TOOLS_PATH,
    TMP_PATH
  } = await import('../../../server/src/constants')

  await prepareTestProfilePath(
    [
      LEON_HOME_PATH,
      LEON_PROFILES_PATH,
      LEON_PROFILE_PATH,
      CACHE_PATH,
      LEON_TOOLKITS_PATH,
      MODELS_PATH,
      TMP_PATH,
      PROFILE_CONTEXT_PATH,
      PROFILE_MEMORY_PATH,
      PROFILE_LOGS_PATH,
      PROFILE_SKILLS_PATH,
      PROFILE_NATIVE_SKILLS_PATH,
      PROFILE_AGENT_SKILLS_PATH,
      PROFILE_TOOLS_PATH
    ],
    PROFILE_DISABLED_PATH
  )

  const continuationStatePath = path.join(
    PROFILE_CONTEXT_PATH,
    AGENT_CONTINUATION_STATE_FILENAME
  )
  const historyCompactionStatePath = path.join(
    PROFILE_CONTEXT_PATH,
    LEGACY_AGENT_HISTORY_COMPACTION_STATE_FILENAME
  )

  await fs.writeFile(
    tempAssetPath,
    `Please list the files in this exact project root directory: ${process.cwd()}.\n`,
    'utf8'
  )

  const {
    ReActLLMDuty
  } = await import('../../../server/src/core/llm-manager/llm-duties/react-llm-duty')
  const { CONVERSATION_LOGGER, TOOL_EXECUTOR, LLM_PROVIDER } = await import(
    '../../../server/src/core/index'
  )
  const { CONFIG_STATE } = await import(
    '../../../server/src/core/config-states/config-state'
  )

  const input = scenario.buildInput(tempAssetPath)
  const toolCalls: AgentTurnResult['toolCalls'] = []
  type ExecuteTool = typeof TOOL_EXECUTOR.executeTool
  type ToolExecutionInput = Parameters<ExecuteTool>[0]
  type ToolExecutionResult = Awaited<ReturnType<ExecuteTool>>

  const originalExecuteTool = TOOL_EXECUTOR.executeTool.bind(
    TOOL_EXECUTOR
  ) as ExecuteTool

  /**
   * Wrap tool execution so the parent spec can assert on real tool usage
   * without changing the production agent path.
   */
  TOOL_EXECUTOR.executeTool = async (
    input: ToolExecutionInput
  ): Promise<ToolExecutionResult> => {
    const toolResult = await originalExecuteTool(input)
    const toolName = `${input.toolkitId}.${input.toolId}.${input.functionName || 'unknown'}`
    const serializedInput = input.toolInput || ''
    const serializedOutput = serializeToolOutput(toolResult)
    const toolCall: AgentTurnResult['toolCalls'][number] = {
      toolId: input.toolId,
      toolOutput: serializedOutput
    }

    if (input.toolkitId !== undefined) {
      toolCall.toolkitId = input.toolkitId
    }

    if (input.functionName !== undefined) {
      toolCall.functionName = input.functionName
    }

    if (input.toolInput !== undefined) {
      toolCall.toolInput = input.toolInput
    }

    if (input.parsedInput && typeof input.parsedInput === 'object') {
      toolCall.parsedInput = { ...input.parsedInput }
    }

    printProgress({
      provider,
      stage: 'tool_call',
      message: `Executed ${toolName}`,
      data: {
        toolName,
        toolInput: summarizeValue(serializedInput),
        toolOutput: summarizeValue(serializedOutput)
      }
    })

    toolCalls.push(toolCall)

    return toolResult
  }

  try {
    /**
     * The e2e subprocess bypasses the normal server bootstrap, so initialize
     * the selected provider explicitly before the first agent turn.
     */
    const isProviderInitialized = await LLM_PROVIDER.init()
    if (!isProviderInitialized) {
      const target = CONFIG_STATE.getModelState().getAgentTarget()
      throw new Error(
        target.resolutionError ||
          `Could not initialize provider "${provider}" with target "${llmTarget}".`
      )
    }
    printProgress({
      provider,
      stage: 'bootstrap',
      message: `Initialized provider ${provider}`,
      data: {
        assetPath: tempAssetPath
      }
    })
    await CONVERSATION_LOGGER.clear()
    await fs.rm(continuationStatePath, { force: true })
    await fs.rm(historyCompactionStatePath, { force: true })

    printProgress({
      provider,
      stage: 'turn_start',
      turn: 1,
      message: `Starting ${scenario.id}`,
      data: { input }
    })

    await CONVERSATION_LOGGER.push(
      createConversationLoggerRecord('owner', input)
    )

    const duty = new ReActLLMDuty({ input })
    await duty.init({ force: true })
    const result = await duty.execute()

    if (!result) {
      throw new Error(
        `Agent scenario "${scenario.id}" returned no result for provider "${provider}".`
      )
    }

    const output = typeof result.output === 'string' ? result.output : ''
    const finalIntent =
      result.data &&
      typeof result.data === 'object' &&
      'finalIntent' in result.data &&
      typeof result.data['finalIntent'] === 'string'
        ? result.data['finalIntent']
        : null
    const turn: AgentTurnResult = {
      input,
      output,
      finalIntent,
      executionHistory:
        result.data &&
        typeof result.data === 'object' &&
        Array.isArray(result.data['executionHistory'])
          ? (result.data['executionHistory'] as AgentTurnResult['executionHistory'])
          : [],
      toolCalls
    }

    if (finalIntent === 'error') {
      const providerUnavailableReason = getProviderUnavailableReason(output)

      if (providerUnavailableReason) {
        printResult({
          provider,
          scenarioId: scenario.id,
          skipped: true,
          reason: providerUnavailableReason,
          assetPath: tempAssetPath,
          turn
        })
        return
      }
    }

    printProgress({
      provider,
      stage: 'turn_result',
      turn: 1,
      message: `Completed ${scenario.id}`,
      data: {
        finalIntent,
        output: summarizeValue(output),
        toolCalls: toolCalls.length
      }
    })

    printResult({
      provider,
      scenarioId: scenario.id,
      skipped: false,
      assetPath: tempAssetPath,
      turn
    })
    printProgress({
      provider,
      stage: 'scenario_complete',
      message: `Completed ${scenario.id}`,
      data: {
        scenarioId: scenario.id
      }
    })
  } finally {
    TOOL_EXECUTOR.executeTool = originalExecuteTool
    await CONVERSATION_LOGGER.clear()
    await fs.rm(tempAssetPath, { force: true })
    await fs.rm(continuationStatePath, { force: true })
    await fs.rm(historyCompactionStatePath, { force: true })
    await removeTestHomePath(LEON_HOME_PATH, testHomePath)
  }
}

void main()
  .then(() => {
    /**
     * Core singletons keep background handles open, so exit explicitly once the
     * structured result has been printed and cleanup has finished.
     */
    process.exit(0)
  })
  .catch((error) => {
    const provider = (process.argv[2] || 'openai') as AgentProvider
    const scenarioId = (process.argv[3] || 'direct_answer') as ProviderScenarioId
    const providerUnavailableReason = getProviderUnavailableReason(error)

    printResult({
      provider,
      scenarioId,
      skipped: Boolean(providerUnavailableReason),
      reason: providerUnavailableReason || String(error)
    })
    process.exit(providerUnavailableReason ? 0 : 1)
  })
