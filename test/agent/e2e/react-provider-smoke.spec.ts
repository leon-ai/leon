import path from 'node:path'
import { fileURLToPath } from 'node:url'

import execa from 'execa'
import { describe, expect, it } from 'vitest'

import { PROVIDER_MATRIX } from './provider-matrix'

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
  skipped: boolean
  reason?: string
  assetPath?: string
  turns?: Array<{
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
  }>
}

function extractTestNamePattern(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (!arg) {
      continue
    }

    if (arg === '-t' || arg === '--testNamePattern' || arg === '--test-name-pattern') {
      return argv[index + 1] || null
    }

    if (arg.startsWith('-t=')) {
      return arg.slice(3) || null
    }

    if (arg.startsWith('--testNamePattern=')) {
      return arg.slice('--testNamePattern='.length) || null
    }

    if (arg.startsWith('--test-name-pattern=')) {
      return arg.slice('--test-name-pattern='.length) || null
    }
  }

  return null
}

function resolveProviderMatrix(
  pattern: string | null
): typeof PROVIDER_MATRIX {
  if (!pattern) {
    return PROVIDER_MATRIX
  }

  const matchesPattern = (provider: string): boolean => {
    const testName = `runs the 3-turn scenario on ${provider}`

    try {
      return new RegExp(pattern, 'i').test(testName)
    } catch {
      return testName.toLowerCase().includes(pattern.toLowerCase())
    }
  }

  const filteredProviders = PROVIDER_MATRIX.filter(({ provider }) =>
    matchesPattern(provider)
  )

  return filteredProviders.length > 0 ? filteredProviders : PROVIDER_MATRIX
}

const ACTIVE_PROVIDER_MATRIX = resolveProviderMatrix(
  process.env['LEON_AGENT_PROVIDER_PATTERN'] ||
    extractTestNamePattern(process.argv)
)

function collectTurnTrace(
  turn: NonNullable<ProviderScenarioResult['turns']>[number]
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
  provider: string
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
      provider
    ],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        LEON_NODE_ENV: 'testing',
        LEON_LLM:
          PROVIDER_MATRIX.find((item) => item.provider === provider)?.llmTarget ||
          provider
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

describe('agent e2e', () => {
  for (const { provider, requiredEnv } of ACTIVE_PROVIDER_MATRIX) {
    /**
     * Missing credentials should skip that provider cleanly rather than fail
     * the whole matrix.
     */
    it.skipIf(!process.env[requiredEnv])(
      `runs the 3-turn scenario on ${provider}`,
      async () => {
        const result = await runProviderScenario(provider)

        console.info(
          `[agent:e2e:${provider}] validating turn outputs and tool usage`
        )

        if (result.skipped) {
          console.info(
            `[agent:e2e:${provider}] skipped at runtime: ${result.reason || 'provider unavailable'}`
          )
          return
        }

        expect(result.turns).toHaveLength(3)

        const [turn1, turn2, turn3] = result.turns!
        const turn2Trace = collectTurnTrace(turn2!)
        const turn3Trace = collectTurnTrace(turn3!)

        expect(turn1!.output.trim().length).toBeGreaterThan(0)
        expect(turn1!.output).toMatch(/ping|pong/i)
        expect(turn1!.finalIntent).toBe('answer')

        expect(turn2!.output.trim().length).toBeGreaterThan(0)
        expect(turn2!.finalIntent).toBe('answer')
        expect(
          turn2!.executionHistory.some(
            (item) =>
              item.function === 'weather.openmeteo.getCurrentConditions'
          ) ||
            turn2!.toolCalls.some(
              (item) =>
                item.toolkitId === 'weather' &&
                item.toolId === 'openmeteo' &&
                item.functionName === 'getCurrentConditions'
            )
        ).toBe(true)
        expect(turn2Trace).toMatch(/shenzhen/i)
        expect(turn2Trace).toMatch(
          /clear|rain|cloud|temperature|feels|humidity|wind|weather|°c|°f/i
        )

        /**
         * The third turn is intentionally structural: we care that Leon read
         * the injected file and listed the project root, not about exact prose.
         */
        expect(turn3!.output.trim().length).toBeGreaterThan(0)
        expect(turn3!.finalIntent).toBe('answer')
        expect(
          turn3!.executionHistory.some(
            (item) =>
              item.function ===
              'operating_system_control.bash.executeBashCommand'
          ) ||
            turn3!.toolCalls.some(
              (item) =>
                item.toolkitId === 'operating_system_control' &&
                item.toolId === 'bash'
            )
        ).toBe(true)
        expect(turn3Trace).toContain(result.assetPath!)
        expect(turn3Trace).toMatch(/project root/i)
      },
      330_000
    )
  }
})
