import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { MessageLog } from '../../../server/src/types'
import type { AgentProvider } from './provider-matrix'
import { PROVIDER_MATRIX, PROVIDER_REQUIRED_ENV } from './provider-matrix'

const RESULT_PREFIX = '__AGENT_RESULT__'
const PROGRESS_PREFIX = '__AGENT_PROGRESS__'
const TEST_HOME_PREFIX = 'leon-agent-e2e'
const TEST_PROFILE_PREFIX = 'agent-e2e'
const EMPTY_PROFILE_DISABLED_CONFIG = {
  skills: [],
  tools: []
}
const REACT_CONTINUATION_STATE_FILENAME =
  '.react-execution-continuation-state.json'
const REACT_HISTORY_COMPACTION_STATE_FILENAME =
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
  skipped: boolean
  reason?: string
  assetPath?: string
  turns?: AgentTurnResult[]
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

async function main(): Promise<void> {
  const providerArg = process.argv[2] as AgentProvider | undefined
  if (!providerArg || !(providerArg in PROVIDER_REQUIRED_ENV)) {
    printResult({
      provider: (providerArg || 'openai') as AgentProvider,
      skipped: true,
      reason: 'invalid_provider'
    })
    return
  }

  const provider = providerArg
  const providerConfig = PROVIDER_MATRIX.find(
    (item) => item.provider === provider
  )
  const requiredEnv = PROVIDER_REQUIRED_ENV[provider]
  const testRunId = `${provider}-${process.pid}-${Date.now()}`
  const testProfileName = `${TEST_PROFILE_PREFIX}-${testRunId}`
  const testHomePath = path.join(
    os.tmpdir(),
    `${TEST_HOME_PREFIX}-${testRunId}`
  )
  if (!process.env[requiredEnv]) {
    printResult({
      provider,
      skipped: true,
      reason: `missing_${requiredEnv.toLowerCase()}`
    })
    return
  }

  process.env['LEON_NODE_ENV'] = 'testing'
  process.env['LEON_LLM'] = providerConfig?.llmTarget || provider
  process.env['LEON_HOME'] = testHomePath
  process.env['LEON_PROFILE'] = testProfileName

  const tempAssetPath = path.join(
    os.tmpdir(),
    `leon-agent-${provider}-${Date.now()}.txt`
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
    REACT_CONTINUATION_STATE_FILENAME
  )
  const historyCompactionStatePath = path.join(
    PROFILE_CONTEXT_PATH,
    REACT_HISTORY_COMPACTION_STATE_FILENAME
  )

  await fs.writeFile(
    tempAssetPath,
    'Hey Leon, please list the files on your project root.\n',
    'utf8'
  )

  const {
    ReActLLMDuty
  } = await import('../../../server/src/core/llm-manager/llm-duties/react-llm-duty')
  const { CONVERSATION_LOGGER, TOOL_EXECUTOR, LLM_PROVIDER } = await import(
    '../../../server/src/core/index'
  )

  const turns: string[] = [
    // Return final answer directly
    'Hi Leon, just doing a quick check since I switched your LLM provider. What do you reply if I tell you "ping"?',
    // Create simple plan
    'What\'s the weather like today in Shenzhen?',
    // Create plan with dynamic replanning (inject new step)
    `There is a file waiting for you in ${tempAssetPath}, do what it asks you to do.`
  ]

  const turnResults: AgentTurnResult[] = []
  const toolCalls: AgentTurnResult['toolCalls'] = []
  type ExecuteTool = typeof TOOL_EXECUTOR.executeTool
  type ToolExecutionInput = Parameters<ExecuteTool>[0]
  type ToolExecutionResult = Awaited<ReturnType<ExecuteTool>>

  const originalExecuteTool = TOOL_EXECUTOR.executeTool.bind(
    TOOL_EXECUTOR
  ) as ExecuteTool

  /**
   * Wrap tool execution so the parent spec can assert on real tool usage
   * without changing the production ReAct path.
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
     * the selected provider explicitly before the first ReAct turn.
     */
    await LLM_PROVIDER.init()
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

    let recordedToolCalls = 0
    for (let index = 0; index < turns.length; index += 1) {
      const input = turns[index]!
      const turnNumber = index + 1

      printProgress({
        provider,
        stage: 'turn_start',
        turn: turnNumber,
        message: `Starting turn ${turnNumber}`,
        data: {
          input
        }
      })

      /**
       * Push each owner/Leon turn through the shared conversation logger so the
       * next ReAct invocation sees real multi-turn history.
       */
      await CONVERSATION_LOGGER.push(
        createConversationLoggerRecord('owner', input)
      )

      const duty = new ReActLLMDuty({ input })
      await duty.init({ force: index === 0 })
      const result = await duty.execute()

      const output =
        result && typeof result.output === 'string' ? result.output : ''
      const finalIntent =
        result &&
        result.data &&
        typeof result.data === 'object' &&
        'finalIntent' in result.data &&
        typeof result.data['finalIntent'] === 'string'
          ? result.data['finalIntent']
          : null

      if (finalIntent === 'error') {
        const providerUnavailableReason = getProviderUnavailableReason(output)

        if (providerUnavailableReason) {
          printResult({
            provider,
            skipped: true,
            reason: providerUnavailableReason,
            assetPath: tempAssetPath,
            turns: turnResults
          })
          return
        }
      }

      if (output) {
        await CONVERSATION_LOGGER.push(
          createConversationLoggerRecord('leon', output)
        )
      }

      printProgress({
        provider,
        stage: 'turn_result',
        turn: turnNumber,
        message: `Completed turn ${turnNumber}`,
        data: {
          finalIntent,
          output: summarizeValue(output),
          toolCalls: toolCalls.length - recordedToolCalls
        }
      })

      turnResults.push({
        input,
        output,
        finalIntent,
        executionHistory:
          result &&
          result.data &&
          typeof result.data === 'object' &&
          Array.isArray(result.data['executionHistory'])
            ? (result.data['executionHistory'] as AgentTurnResult['executionHistory'])
            : [],
        toolCalls: toolCalls.slice(recordedToolCalls)
      })

      recordedToolCalls = toolCalls.length
    }

    printResult({
      provider,
      skipped: false,
      assetPath: tempAssetPath,
      turns: turnResults
    })
    printProgress({
      provider,
      stage: 'scenario_complete',
      message: `Completed ${turnResults.length} turns`,
      data: {
        turns: turnResults.length
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
    const providerUnavailableReason = getProviderUnavailableReason(error)

    printResult({
      provider,
      skipped: Boolean(providerUnavailableReason),
      reason: providerUnavailableReason || String(error)
    })
    process.exit(providerUnavailableReason ? 0 : 1)
  })
