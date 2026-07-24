import path from 'node:path'
import { fileURLToPath } from 'node:url'

import execa from 'execa'
import { describe, expect, it } from 'vitest'

import { PROFILE_CONFIG_PATH } from '@/leon-roots'

import { PROVIDER_MATRIX } from './provider-matrix'
import {
  PROVIDER_SCENARIOS,
  type ProviderScenario,
  type ProviderScenarioId
} from './provider-scenarios'

const CURRENT_DIR = fileURLToPath(new URL('.', import.meta.url))
const ROOT_DIR = path.resolve(CURRENT_DIR, '..', '..', '..')
const RESULT_PREFIX = '__AGENT_RESULT__'
const PROGRESS_PREFIX = '__AGENT_PROGRESS__'

interface ProviderProgressEvent {
  provider: string
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

interface ProviderScenarioResult {
  provider: string
  scenarioId: ProviderScenarioId
  skipped: boolean
  reason?: string
  assetPath?: string
  turn?: {
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
}

function resolveProviderMatrix(
  providerFilter: string | null
): typeof PROVIDER_MATRIX {
  if (!providerFilter) {
    return PROVIDER_MATRIX
  }

  const normalizedFilter = providerFilter.trim().toLowerCase()
  const filteredProviders = PROVIDER_MATRIX.filter(({ provider }) =>
    provider.toLowerCase() === normalizedFilter
  )

  if (filteredProviders.length === 0) {
    throw new Error(
      `Unknown agent E2E provider "${providerFilter}". Expected one of: ${PROVIDER_MATRIX.map(({ provider }) => provider).join(', ')}.`
    )
  }

  return filteredProviders
}

const ACTIVE_PROVIDER_MATRIX = resolveProviderMatrix(
  process.env['LEON_AGENT_PROVIDER_FILTER'] || null
)

function collectTurnTrace(
  turn: NonNullable<ProviderScenarioResult['turn']>
): string {
  return [
    turn.output,
    ...turn.executionHistory.map((item) => item.observation),
    ...turn.executionHistory.map((item) => item.requestedToolInput || ''),
    ...turn.toolCalls.map((item) => item.toolInput || ''),
    ...turn.toolCalls.map((item) => item.toolOutput || ''),
    ...turn.toolCalls.map((item) =>
      item.parsedInput ? JSON.stringify(item.parsedInput) : ''
    )
  ]
    .filter(Boolean)
    .join('\n')
}

function summarizeText(value: string | undefined, maxLength = 500): string {
  if (!value) {
    return ''
  }

  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`
}

function summarizeScenarioResult(result: ProviderScenarioResult): string {
  return JSON.stringify(
    {
      provider: result.provider,
      scenarioId: result.scenarioId,
      skipped: result.skipped,
      reason: result.reason,
      assetPath: result.assetPath,
      turn: result.turn
        ? {
            input: result.turn.input,
            output: summarizeText(result.turn.output),
            finalIntent: result.turn.finalIntent,
            executionHistory: result.turn.executionHistory.map((item) => ({
              function: item.function,
              status: item.status,
              stepLabel: item.stepLabel,
              observation: summarizeText(item.observation),
              requestedToolInput: summarizeText(item.requestedToolInput)
            })),
            toolCalls: result.turn.toolCalls.map((item) => ({
              toolkitId: item.toolkitId,
              toolId: item.toolId,
              functionName: item.functionName,
              toolInput: summarizeText(item.toolInput),
              parsedInput: item.parsedInput,
              toolOutput: summarizeText(item.toolOutput)
            }))
          }
        : undefined
    },
    null,
    2
  )
}

function formatProgressEvent(event: ProviderProgressEvent): string {
  const prefix = `[agent:e2e:${event.provider}]`

  if (event.stage === 'turn_start') {
    return `${prefix} turn ${event.turn} input=${JSON.stringify(event.data?.['input'] || '')}`
  }

  if (event.stage === 'tool_call') {
    return `${prefix} tool=${event.data?.['toolName'] || 'unknown'} input=${JSON.stringify(event.data?.['toolInput'] || '')} output=${JSON.stringify(event.data?.['toolOutput'] || '')}`
  }

  if (event.stage === 'turn_result') {
    return `${prefix} turn ${event.turn} intent=${String(event.data?.['finalIntent'] || 'unknown')} toolCalls=${String(event.data?.['toolCalls'] || 0)} output=${JSON.stringify(event.data?.['output'] || '')}`
  }

  if (event.stage === 'bootstrap') {
    return `${prefix} bootstrap asset=${JSON.stringify(event.data?.['assetPath'] || '')}`
  }

  return `${prefix} ${event.message}`
}

async function runProviderScenario(
  provider: string,
  scenarioId: ProviderScenarioId
): Promise<ProviderScenarioResult> {
  /**
   * Provider choice is read at module-load time, so each provider run needs a
   * fresh process with its own env.
   */
  const childProcess = execa(
    'node',
    [
      '--import',
      'tsx',
      'test/agent/e2e/run-agent-provider-scenario.ts',
      provider,
      scenarioId
    ],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        LEON_NODE_ENV: 'testing',
        LEON_LLM:
          PROVIDER_MATRIX.find((item) => item.provider === provider)?.llmTarget ||
          provider,
        LEON_AGENT_E2E_SOURCE_CONFIG_PATH: PROFILE_CONFIG_PATH
      },
      all: true,
      reject: false,
      timeout: 300_000
    }
  )

  let streamBuffer = ''
  childProcess.all?.setEncoding('utf8')
  childProcess.all?.on('data', (chunk: string) => {
    streamBuffer += chunk
    const lines = streamBuffer.split('\n')
    streamBuffer = lines.pop() || ''

    for (const rawLine of lines) {
      const line = rawLine.trim()

      if (!line.startsWith(PROGRESS_PREFIX)) {
        continue
      }

      const payload = line.slice(PROGRESS_PREFIX.length)

      try {
        const event = JSON.parse(payload) as ProviderProgressEvent
        console.info(formatProgressEvent(event))
      } catch {
        console.info(`[agent:e2e:${provider}] ${payload}`)
      }
    }
  })

  const { stdout, stderr, exitCode } = await childProcess

  const combinedOutput = `${stdout}\n${stderr}`
  const resultLine = combinedOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(RESULT_PREFIX))
    .at(-1)

  if (!resultLine) {
    throw new Error(
      `Missing agent result marker for provider "${provider}". Output:\n${combinedOutput}`
    )
  }

  const result = JSON.parse(
    resultLine.slice(RESULT_PREFIX.length)
  ) as ProviderScenarioResult

  if (exitCode !== 0 && !result.skipped) {
    throw new Error(
      `Provider "${provider}" scenario failed with exit code ${exitCode}. Output:\n${combinedOutput}`
    )
  }

  return result
}

function expectDirectAnswerScenario(result: ProviderScenarioResult): void {
  const turn = result.turn!

  expect(turn.output.trim().length).toBeGreaterThan(0)
  expect(turn.output).toMatch(/ping|pong/i)
  expect(turn.finalIntent).toBe('answer')
  expect(turn.executionHistory).toHaveLength(0)
}

function expectWeatherScenario(result: ProviderScenarioResult): void {
  const turn = result.turn!
  const trace = collectTurnTrace(turn)

  expect(turn.output.trim().length).toBeGreaterThan(0)
  expect(turn.finalIntent).toBe('answer')
  expect(
    turn.executionHistory.some(
      (item) => item.function === 'weather.openmeteo.getCurrentConditions'
    )
  ).toBe(true)
  expect(trace).toMatch(/shenzhen/i)
  expect(trace).toMatch(
    /clear|rain|cloud|temperature|feels|humidity|wind|weather|°c|°f/i
  )
}

function expectFileInstructionsScenario(result: ProviderScenarioResult): void {
  const turn = result.turn!
  const trace = collectTurnTrace(turn)
  const fileReadIndex = turn.executionHistory.findIndex(
    (item) => item.function === 'operating_system_control.file.read'
  )
  const shellIndex = turn.executionHistory.findIndex(
    (item) =>
      item.function === 'operating_system_control.shell.executeCommand'
  )

  expect(turn.output.trim().length).toBeGreaterThan(0)
  expect(turn.finalIntent).toBe('answer')
  expect(fileReadIndex).toBeGreaterThanOrEqual(0)
  expect(shellIndex).toBeGreaterThan(fileReadIndex)
  expect(trace).toContain(result.assetPath!)
  expect(trace).toMatch(/project root/i)
}

function expectProviderScenarioResult(
  scenario: ProviderScenario,
  result: ProviderScenarioResult
): void {
  if (scenario.id === 'direct_answer') {
    expectDirectAnswerScenario(result)
    return
  }

  if (scenario.id === 'weather') {
    expectWeatherScenario(result)
    return
  }

  expectFileInstructionsScenario(result)
}

describe('agent e2e', () => {
  for (const { provider, requiredEnv } of ACTIVE_PROVIDER_MATRIX) {
    for (const scenario of PROVIDER_SCENARIOS) {
      /** Missing credentials skip each independently reported scenario. */
      it.skipIf(!process.env[requiredEnv])(
        `${scenario.testName} on ${provider}`,
        async () => {
          const result = await runProviderScenario(provider, scenario.id)

          console.info(
            `[agent:e2e:${provider}:${scenario.id}] validating output and tool usage`
          )

          try {
            if (result.skipped) {
              console.info(
                `[agent:e2e:${provider}:${scenario.id}] skipped at runtime: ${result.reason || 'provider unavailable'}`
              )
              return
            }

            expect(result.scenarioId).toBe(scenario.id)
            expect(result.turn).toBeDefined()
            expectProviderScenarioResult(scenario, result)
          } catch (error) {
            console.info(
              `[agent:e2e:${provider}:${scenario.id}] result on assertion failure:\n${summarizeScenarioResult(result)}`
            )
            throw error
          }
        },
        330_000
      )
    }
  }
})
