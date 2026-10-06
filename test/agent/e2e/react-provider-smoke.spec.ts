import path from 'node:path'
import { fileURLToPath } from 'node:url'

import execa from 'execa'
import type { CodingEvidence } from './coding-fixture'
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
  coding?: CodingEvidence
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
): readonly (typeof PROVIDER_MATRIX)[number][] {
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
      coding: result.coding,
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
      scenarioId,
      // SDK imports must not treat the scenario as a native-skill intent path.
      '--runtime',
      'tool'
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
      (item) => item.function === 'weather.openmeteo.getWeather'
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
  const listingIndex = turn.executionHistory.findIndex(
    (item) =>
      item.function === 'operating_system_control.shell.executeCommand'
      || item.function === 'operating_system_control.ripgrep.listFiles'
  )

  expect(turn.output.trim().length).toBeGreaterThan(0)
  expect(turn.finalIntent).toBe('answer')
  expect(fileReadIndex).toBeGreaterThanOrEqual(0)
  expect(listingIndex).toBeGreaterThan(fileReadIndex)
  expect(turn.output).toContain('README.md')
  expect(turn.output).toContain('package.json')
  expect(trace).toContain(result.assetPath!)
  expect(trace).toMatch(/project root/i)
}

function expectProviderScenarioResult(
  scenario: ProviderScenario,
  result: ProviderScenarioResult
): void {
  if (scenario.id.startsWith('coding_')) {
    expectCodingScenario(scenario.id, result)
    return
  }
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

/**
 * Assess actual repository state and process evidence independently of the answer.
 */
function expectCodingScenario(id: ProviderScenarioId, result: ProviderScenarioResult): void {
  const turn = result.turn!
  expect(turn.finalIntent).toBe('answer')
  expect(result.coding).toMatchObject({
    baselineFailed: true,
    testsPassed: true,
    protectedFilesPreserved: true,
    stagedDiffPreserved: true,
    headPreserved: true
  })
  const expectedFiles = id === 'coding_multiple_files'
    ? ['src/price.mjs', 'src/receipt.mjs']
    : id === 'coding_session' ? ['src/greeting.mjs'] : ['src/math.mjs']
  expect(result.coding!.changedFiles).toEqual(expectedFiles)

  const patchIndex = turn.toolCalls.findIndex((call) => call.functionName === 'patch')
  expect(patchIndex).toBeGreaterThanOrEqual(0)
  const before = turn.toolCalls.slice(0, patchIndex)
  const reads = before.filter((call) => call.toolId === 'file' && call.functionName === 'read')
  const readPaths = reads.map((call) => String(call.parsedInput?.['path'] || '').replaceAll('\\', '/'))
  expect(readPaths.some((value) => value.endsWith('/AGENTS.md') && !value.endsWith('/src/AGENTS.md'))).toBe(true)
  expect(readPaths.some((value) => value.endsWith('/src/AGENTS.md'))).toBe(true)
  // Finite commands are transported as temporary scripts. The history retains
  // the requested command and its observation, so assess those together.
  const firstPatch = turn.executionHistory.findIndex((item) => item.function === 'operating_system_control.file.patch')
  const lastPatch = turn.executionHistory.findLastIndex((item) => item.function === 'operating_system_control.file.patch')
  const isProjectTest = (item: typeof turn.executionHistory[number]): boolean => {
    const input = JSON.parse(item.requestedToolInput || '{}') as Record<string, unknown>
    const command = String(input['command'] || '')
    return item.function === 'operating_system_control.shell.executeCommand'
      && command.includes('pnpm') && command.includes('test')
  }
  expect(firstPatch).toBeGreaterThanOrEqual(0)
  expect(turn.executionHistory.slice(0, firstPatch).some((item) => isProjectTest(item)
    && shellResult({ toolOutput: item.observation })['commandSucceeded'] === false)).toBe(true)
  expect(turn.executionHistory.slice(lastPatch + 1).some((item) => isProjectTest(item)
    && shellResult({ toolOutput: item.observation })['commandSucceeded'] === true)).toBe(true)

  if (id === 'coding_session') {
    expect(result.coding!.sessionsStopped).toBe(true)
    expect(before.some((call) => call.functionName === 'startSession')).toBe(true)
    expect(before.some((call) => call.functionName === 'writeSession')).toBe(true)
    const sessionCalls = turn.toolCalls.filter((call) => call.toolId === 'shell')
    const launches = sessionCalls.filter((call) => call.functionName === 'startSession')
    expect(launches).toHaveLength(1)
    const started = shellResult(launches[0]!)['data'] as Record<string, unknown>
    const sessionId = started['sessionId']
    expect(typeof sessionId).toBe('string')
    for (const call of sessionCalls.filter((item) => ['readSession', 'writeSession', 'stopSession'].includes(item.functionName || ''))) {
      expect(call.parsedInput?.['sessionId']).toBe(sessionId)
    }
    expect(before.some((call) => call.functionName === 'readSession'
      && String((shellResult(call)['data'] as Record<string, unknown>)?.['output']).includes('HELLO Ada'))).toBe(true)
    const corrected = sessionCalls.find((call) => call.functionName === 'readSession'
      && String((shellResult(call)['data'] as Record<string, unknown>)?.['output']).includes('Hello, Ada!'))
    expect(corrected).toBeDefined()
    const stopped = sessionCalls.find((call) => call.functionName === 'stopSession')
    expect(stopped).toBeDefined()
    expect(shellResult(stopped!)['data']).toMatchObject({ running: false, status: 'stopped' })
  }
}

function shellResult(call: { toolOutput?: string }): Record<string, unknown> {
  const parsed = JSON.parse(call.toolOutput || '{}') as {
    data?: { output?: { result?: Record<string, unknown> } }
  }
  return parsed.data?.output?.result || {}
}

describe('agent e2e', () => {
  for (const { provider, requiredEnv } of ACTIVE_PROVIDER_MATRIX) {
    for (const scenario of PROVIDER_SCENARIOS) {
      /**
       * Missing credentials skip each independently reported scenario.
       */
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
